"""
Training data preparation utilities.

This module downloads Tessera embeddings for a region and samples from them,
rather than making individual API calls per point.
"""

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.merge import merge
from rasterio.crs import CRS
from pathlib import Path
from typing import Optional
from tqdm import tqdm
import logging

from geotessera import GeoTessera

logger = logging.getLogger(__name__)


def generate_negative_samples(
    positive_points: list[tuple[float, float]],
    n_samples: int,
    bbox: tuple[float, float, float, float],
    min_distance: float = 0.005,
    seed: Optional[int] = None
) -> list[tuple[float, float]]:
    """
    Generate random negative samples within bbox, avoiding positive point locations.

    Args:
        positive_points: List of (lon, lat) tuples for positive examples
        n_samples: Number of negative samples to generate
        bbox: (min_lon, min_lat, max_lon, max_lat)
        min_distance: Minimum distance (in degrees) from any positive point (~500m at mid-latitudes)
        seed: Random seed for reproducibility

    Returns:
        List of (lon, lat) tuples for negative examples
    """
    if seed is not None:
        np.random.seed(seed)

    min_lon, min_lat, max_lon, max_lat = bbox
    positive_arr = np.array(positive_points)

    negative_points = []
    attempts = 0
    max_attempts = n_samples * 100

    while len(negative_points) < n_samples and attempts < max_attempts:
        lon = np.random.uniform(min_lon, max_lon)
        lat = np.random.uniform(min_lat, max_lat)

        # Check distance to all positive points
        distances = np.sqrt((positive_arr[:, 0] - lon)**2 + (positive_arr[:, 1] - lat)**2)

        if np.min(distances) > min_distance:
            negative_points.append((lon, lat))

        attempts += 1

    if len(negative_points) < n_samples:
        logger.warning(f"Only generated {len(negative_points)} negative samples (requested {n_samples})")

    return negative_points


class EmbeddingManager:
    """
    Manages downloading and sampling from Tessera embeddings for a region.

    This is more efficient than calling the API per-point because it downloads
    the embedding tiles once and then samples from the in-memory mosaic.
    """

    # Default path to local numpy cache
    LOCAL_CACHE_DIR = Path(__file__).parent.parent / "global_0.1_degree_representation"

    def __init__(self, bbox: tuple[float, float, float, float], year: int = 2024,
                 local_cache_dir: Optional[Path] = None):
        """
        Initialize the embedding manager.

        Args:
            bbox: (min_lon, min_lat, max_lon, max_lat)
            year: Year for Tessera embeddings
            local_cache_dir: Path to local numpy tile cache (default: global_0.1_degree_representation)
        """
        self.bbox = bbox
        self.year = year
        self.embedding_mosaic = None
        self.mosaic_transform = None
        self.mosaic_crs = None
        self.local_cache_dir = local_cache_dir or self.LOCAL_CACHE_DIR
        self.gt = None  # Lazy load GeoTessera only if needed

    def download_embeddings(self, cache_path: Optional[Path] = None) -> None:
        """
        Download embeddings for the region.

        Args:
            cache_path: Optional path to save/load cached embeddings
        """
        min_lon, min_lat, max_lon, max_lat = self.bbox

        # Check for cached GeoTIFF embeddings
        if cache_path and cache_path.exists():
            logger.info(f"Loading cached embeddings from {cache_path}")
            self._load_from_tif(cache_path)
            return

        # Try to load from local numpy cache first
        if self._load_from_local_cache():
            logger.info(f"  Mosaic shape: {self.embedding_mosaic.shape}")
            if cache_path:
                self._save_to_tif(cache_path)
            return

        logger.info(f"Downloading Tessera embeddings from API...")
        logger.info(f"  Bbox: lon [{min_lon:.3f}, {max_lon:.3f}], lat [{min_lat:.3f}, {max_lat:.3f}]")
        logger.info(f"  Year: {self.year}")

        # Lazy load GeoTessera
        if self.gt is None:
            self.gt = GeoTessera()

        # Get tiles for region
        roi_bounds = (min_lon, min_lat, max_lon, max_lat)
        tiles_to_fetch = self.gt.registry.load_blocks_for_region(bounds=roi_bounds, year=self.year)

        if not tiles_to_fetch:
            raise ValueError(f"No Tessera tiles available for region {roi_bounds} in year {self.year}")

        logger.info(f"  Fetching {len(tiles_to_fetch)} tiles...")

        # Fetch tiles and create mosaic
        # Use a consistent CRS for all tiles (EPSG:4326 - WGS84)
        target_crs = CRS.from_epsg(4326)
        tile_datasets = []
        memfiles = []  # Keep references to prevent garbage collection
        for year, tile_lon, tile_lat, embedding_array, crs, transform in tqdm(
            self.gt.fetch_embeddings(tiles_to_fetch), total=len(tiles_to_fetch), desc="Downloading tiles"
        ):
            # Create in-memory rasterio dataset
            height, width, channels = embedding_array.shape
            memfile = MemoryFile()
            memfiles.append(memfile)  # Keep reference
            dataset = memfile.open(
                driver='GTiff',
                height=height,
                width=width,
                count=channels,
                dtype=embedding_array.dtype,
                crs=target_crs,  # Use consistent CRS
                transform=transform
            )
            # Write data (rasterio expects channels first)
            for i in range(channels):
                dataset.write(embedding_array[:, :, i], i + 1)
            tile_datasets.append(dataset)

        # Merge tiles into mosaic
        logger.info("  Merging tiles into mosaic...")
        mosaic_data, mosaic_transform = merge(tile_datasets)

        # Convert from (channels, height, width) to (height, width, channels)
        self.embedding_mosaic = np.moveaxis(mosaic_data, 0, -1)
        self.mosaic_transform = mosaic_transform
        self.mosaic_crs = target_crs

        # Clean up
        for ds in tile_datasets:
            ds.close()
        memfiles.clear()  # Clear memfile references

        logger.info(f"  Mosaic shape: {self.embedding_mosaic.shape}")

        # Cache if path provided
        if cache_path:
            self._save_to_tif(cache_path)

    def _load_from_tif(self, path: Path) -> None:
        """Load embeddings from a cached GeoTIFF file."""
        with rasterio.open(path) as src:
            data = src.read()
            self.embedding_mosaic = np.moveaxis(data, 0, -1)
            self.mosaic_transform = src.transform
            self.mosaic_crs = src.crs
        logger.info(f"  Loaded mosaic shape: {self.embedding_mosaic.shape}")

    def _load_from_local_cache(self) -> bool:
        """
        Try to load embeddings from local numpy cache.

        The cache is organized as:
        global_0.1_degree_representation/{year}/grid_{lon}_{lat}/grid_{lon}_{lat}.npy

        Returns:
            True if successfully loaded from cache, False otherwise
        """
        min_lon, min_lat, max_lon, max_lat = self.bbox
        cache_year_dir = self.local_cache_dir / str(self.year)

        if not cache_year_dir.exists():
            logger.info(f"Local cache directory not found: {cache_year_dir}")
            return False

        logger.info(f"Loading Tessera embeddings from local cache...")
        logger.info(f"  Bbox: lon [{min_lon:.3f}, {max_lon:.3f}], lat [{min_lat:.3f}, {max_lat:.3f}]")
        logger.info(f"  Cache dir: {cache_year_dir}")

        # Find tiles that cover the bbox (0.1 degree grid)
        # Tile naming: grid_{lon}_{lat} where lon/lat are the SW corner
        tiles_data = []
        tiles_info = []

        # Grid step is 0.1 degrees
        step = 0.1
        # Round to nearest 0.1, offset by 0.05 to get grid centers
        start_lon = np.floor((min_lon + 0.05) / step) * step - 0.05
        start_lat = np.floor((min_lat + 0.05) / step) * step - 0.05
        end_lon = np.ceil((max_lon + 0.05) / step) * step - 0.05
        end_lat = np.ceil((max_lat + 0.05) / step) * step - 0.05

        lons = np.arange(start_lon, end_lon + step/2, step)
        lats = np.arange(start_lat, end_lat + step/2, step)

        logger.info(f"  Looking for {len(lons) * len(lats)} tiles...")

        for lon in lons:
            for lat in lats:
                tile_name = f"grid_{lon:.2f}_{lat:.2f}".replace("-", "-")
                tile_dir = cache_year_dir / tile_name
                npy_file = tile_dir / f"{tile_name}.npy"
                scales_file = tile_dir / f"{tile_name}_scales.npy"

                if npy_file.exists() and scales_file.exists():
                    data = np.load(npy_file)
                    scales = np.load(scales_file)
                    # De-quantize: int8 * scales -> float32
                    embeddings = data.astype(np.float32) * scales[:, :, np.newaxis]
                    tiles_data.append(embeddings)
                    tiles_info.append((lon, lat, embeddings.shape))

        if not tiles_data:
            logger.info("  No cached tiles found for region")
            return False

        logger.info(f"  Loaded {len(tiles_data)} tiles from cache")

        # Create mosaic by stitching tiles together
        # Tiles are 0.1 degree each, need to arrange in a grid
        unique_lons = sorted(set(t[0] for t in tiles_info))
        unique_lats = sorted(set(t[1] for t in tiles_info), reverse=True)  # Top to bottom

        # Get consistent tile dimensions (use minimum to avoid out of bounds)
        all_heights = [t[2][0] for t in tiles_info]
        all_widths = [t[2][1] for t in tiles_info]
        tile_h = min(all_heights)
        tile_w = min(all_widths)
        channels = tiles_info[0][2][2]

        logger.info(f"  Using tile size: {tile_h}x{tile_w}x{channels}")

        # Create index mapping
        tile_map = {(t[0], t[1]): i for i, t in enumerate(tiles_info)}

        # Stitch tiles (crop to consistent size)
        rows = []
        for lat in unique_lats:
            row_tiles = []
            for lon in unique_lons:
                if (lon, lat) in tile_map:
                    tile = tiles_data[tile_map[(lon, lat)]]
                    # Crop to consistent size
                    row_tiles.append(tile[:tile_h, :tile_w, :])
                else:
                    # Missing tile - fill with zeros
                    row_tiles.append(np.zeros((tile_h, tile_w, channels), dtype=np.float32))
            rows.append(np.concatenate(row_tiles, axis=1))

        self.embedding_mosaic = np.concatenate(rows, axis=0)

        # Create transform for the mosaic
        # The mosaic covers from min(lons) to max(lons)+0.1 and min(lats) to max(lats)+0.1
        mosaic_min_lon = min(unique_lons)
        mosaic_max_lat = max(unique_lats) + step

        # Calculate pixel size
        pixel_width = (step * len(unique_lons)) / self.embedding_mosaic.shape[1]
        pixel_height = (step * len(unique_lats)) / self.embedding_mosaic.shape[0]

        self.mosaic_transform = rasterio.transform.from_bounds(
            mosaic_min_lon,
            mosaic_max_lat - step * len(unique_lats),
            mosaic_min_lon + step * len(unique_lons),
            mosaic_max_lat,
            self.embedding_mosaic.shape[1],
            self.embedding_mosaic.shape[0]
        )
        self.mosaic_crs = CRS.from_epsg(4326)

        return True

    def _save_to_tif(self, path: Path) -> None:
        """Save embeddings to a GeoTIFF file for caching."""
        path.parent.mkdir(parents=True, exist_ok=True)
        height, width, channels = self.embedding_mosaic.shape

        with rasterio.open(
            path, 'w',
            driver='GTiff',
            height=height,
            width=width,
            count=channels,
            dtype=self.embedding_mosaic.dtype,
            crs=self.mosaic_crs,
            transform=self.mosaic_transform,
            compress='lzw'
        ) as dst:
            for i in range(channels):
                dst.write(self.embedding_mosaic[:, :, i], i + 1)
        logger.info(f"  Cached embeddings to {path}")

    def sample_at_points(
        self, points: list[tuple[float, float]]
    ) -> tuple[np.ndarray, np.ndarray]:
        """
        Sample embeddings at the given points.

        Args:
            points: List of (lon, lat) tuples

        Returns:
            Tuple of (embeddings, valid_mask)
            - embeddings: numpy array of shape (n_points, 128)
            - valid_mask: boolean array indicating which points are valid
        """
        if self.embedding_mosaic is None:
            raise RuntimeError("Embeddings not downloaded yet. Call download_embeddings() first.")

        height, width, channels = self.embedding_mosaic.shape
        embeddings = np.zeros((len(points), channels), dtype=np.float32)
        valid_mask = np.ones(len(points), dtype=bool)

        for i, (lon, lat) in enumerate(points):
            # Convert lon/lat to pixel coordinates
            row, col = rasterio.transform.rowcol(self.mosaic_transform, lon, lat)

            if 0 <= row < height and 0 <= col < width:
                embeddings[i] = self.embedding_mosaic[row, col, :]
            else:
                valid_mask[i] = False

        return embeddings, valid_mask


def prepare_training_data(
    positive_points: list[tuple[float, float]],
    negative_points: list[tuple[float, float]],
    bbox: tuple[float, float, float, float],
    year: int = 2024,
    cache_path: Optional[Path] = None
) -> tuple[np.ndarray, np.ndarray, list[tuple[float, float]], EmbeddingManager]:
    """
    Prepare training data by downloading Tessera embeddings and sampling at points.

    Args:
        positive_points: List of (lon, lat) tuples for positive examples
        negative_points: List of (lon, lat) tuples for negative examples
        bbox: (min_lon, min_lat, max_lon, max_lat) for the region
        year: Year for Tessera embeddings
        cache_path: Optional path to cache the downloaded embeddings

    Returns:
        Tuple of (X features, y labels, valid_points, embedding_manager)
        - X: numpy array of shape (n_valid_samples, 128)
        - y: numpy array of labels (1 for positive, 0 for negative)
        - valid_points: list of (lon, lat) tuples for valid samples
        - embedding_manager: the EmbeddingManager instance for reuse in prediction
    """
    # Create embedding manager and download
    em = EmbeddingManager(bbox=bbox, year=year)
    em.download_embeddings(cache_path=cache_path)

    # Combine points and create labels
    all_points = positive_points + negative_points
    labels = [1] * len(positive_points) + [0] * len(negative_points)

    # Sample embeddings
    logger.info(f"Sampling embeddings for {len(all_points)} training points...")
    embeddings, valid_mask = em.sample_at_points(all_points)

    n_invalid = (~valid_mask).sum()
    if n_invalid > 0:
        logger.warning(f"{n_invalid} points outside embedding coverage")

    X = embeddings[valid_mask]
    y = np.array(labels)[valid_mask]
    valid_points = [p for p, v in zip(all_points, valid_mask) if v]

    n_pos = y.sum()
    n_neg = len(y) - n_pos
    logger.info(f"Valid training samples: {len(X)} (positive: {n_pos}, negative: {n_neg})")

    return X, y, valid_points, em


def subsample_training_data(
    X: np.ndarray,
    y: np.ndarray,
    n_positive: int,
    seed: Optional[int] = None
) -> tuple[np.ndarray, np.ndarray]:
    """
    Subsample training data to use fewer positive examples.
    Useful for studying the effect of training set size.

    Args:
        X: Feature matrix
        y: Labels
        n_positive: Number of positive samples to keep
        seed: Random seed

    Returns:
        Tuple of (X_sub, y_sub)
    """
    if seed is not None:
        np.random.seed(seed)

    positive_idx = np.where(y == 1)[0]
    negative_idx = np.where(y == 0)[0]

    # Subsample positive examples
    n_pos = min(n_positive, len(positive_idx))
    selected_pos = np.random.choice(positive_idx, size=n_pos, replace=False)

    # Use same number of negative examples
    n_neg = min(n_positive, len(negative_idx))
    selected_neg = np.random.choice(negative_idx, size=n_neg, replace=False)

    selected_idx = np.concatenate([selected_pos, selected_neg])
    np.random.shuffle(selected_idx)

    return X[selected_idx], y[selected_idx]
