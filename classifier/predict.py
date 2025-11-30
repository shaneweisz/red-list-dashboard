"""
Prediction and candidate location generation.
"""

import numpy as np
import json
import logging
from pathlib import Path
from typing import Optional

from .model import SpeciesClassifier
from .training import EmbeddingManager

logger = logging.getLogger(__name__)


def generate_prediction_grid(
    bbox: tuple[float, float, float, float],
    resolution: float = 0.005
) -> tuple[list[tuple[float, float]], int, int]:
    """
    Generate a grid of points for prediction.

    Args:
        bbox: (min_lon, min_lat, max_lon, max_lat)
        resolution: Grid spacing in degrees (~500m at mid-latitudes for 0.005)

    Returns:
        Tuple of (grid_points, n_lon, n_lat)
    """
    min_lon, min_lat, max_lon, max_lat = bbox

    lon_grid = np.arange(min_lon, max_lon, resolution)
    lat_grid = np.arange(min_lat, max_lat, resolution)

    grid_points = [(lon, lat) for lat in lat_grid for lon in lon_grid]

    return grid_points, len(lon_grid), len(lat_grid)


def generate_candidate_locations(
    classifier: SpeciesClassifier,
    embedding_manager: EmbeddingManager,
    probability_threshold: float = 0.7,
    resolution: float = 0.005,
) -> dict:
    """
    Generate candidate locations by applying the classifier to a grid.

    Uses the already-downloaded embedding mosaic from the EmbeddingManager.

    Args:
        classifier: Trained SpeciesClassifier
        embedding_manager: EmbeddingManager with downloaded embeddings
        probability_threshold: Minimum probability to include as candidate
        resolution: Grid spacing in degrees

    Returns:
        GeoJSON FeatureCollection of candidate locations
    """
    bbox = embedding_manager.bbox

    # Generate grid
    grid_points, n_lon, n_lat = generate_prediction_grid(bbox, resolution)
    logger.info(f"Prediction grid: {len(grid_points)} points ({n_lon} x {n_lat})")

    # Sample embeddings from mosaic
    logger.info("Sampling embeddings for prediction grid...")
    embeddings, valid_mask = embedding_manager.sample_at_points(grid_points)

    # Predict probabilities for valid points
    probabilities = np.zeros(len(grid_points))
    probabilities[~valid_mask] = np.nan

    if valid_mask.any():
        valid_embeddings = embeddings[valid_mask]
        probabilities[valid_mask] = classifier.predict_proba(valid_embeddings)

    # Extract candidate locations
    candidates = []
    for point, prob in zip(grid_points, probabilities):
        if np.isnan(prob) or prob < probability_threshold:
            continue

        lon, lat = point
        candidates.append({
            "type": "Feature",
            "properties": {
                "probability": float(prob),
                "model_type": classifier.model_type,
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        })

    logger.info(f"Found {len(candidates)} candidate locations with probability >= {probability_threshold}")

    return {
        "type": "FeatureCollection",
        "name": "candidate_locations",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "features": candidates,
        "metadata": {
            "bbox": list(bbox),
            "resolution": resolution,
            "probability_threshold": probability_threshold,
            "total_grid_points": len(grid_points),
            "valid_grid_points": int(valid_mask.sum()),
            "n_candidates": len(candidates),
        }
    }


def generate_probability_raster(
    classifier: SpeciesClassifier,
    embedding_manager: EmbeddingManager,
    resolution: float = 0.005,
) -> tuple[np.ndarray, dict]:
    """
    Generate a probability raster for the entire region.

    Args:
        classifier: Trained SpeciesClassifier
        embedding_manager: EmbeddingManager with downloaded embeddings
        resolution: Grid spacing in degrees

    Returns:
        Tuple of (probability_grid, metadata)
        - probability_grid: 2D numpy array of probabilities (lat, lon)
        - metadata: Dictionary with grid info
    """
    bbox = embedding_manager.bbox
    min_lon, min_lat, max_lon, max_lat = bbox

    lon_grid = np.arange(min_lon, max_lon, resolution)
    lat_grid = np.arange(min_lat, max_lat, resolution)
    grid_points = [(lon, lat) for lat in lat_grid for lon in lon_grid]

    logger.info(f"Generating probability raster: {len(lon_grid)} x {len(lat_grid)} = {len(grid_points)} points")

    # Sample embeddings
    embeddings, valid_mask = embedding_manager.sample_at_points(grid_points)

    # Predict
    probabilities = np.zeros(len(grid_points))
    probabilities[~valid_mask] = np.nan

    if valid_mask.any():
        probabilities[valid_mask] = classifier.predict_proba(embeddings[valid_mask])

    # Reshape to grid (lat, lon)
    prob_grid = probabilities.reshape(len(lat_grid), len(lon_grid))

    metadata = {
        "bbox": list(bbox),
        "resolution": resolution,
        "shape": list(prob_grid.shape),
        "lon_range": [float(lon_grid.min()), float(lon_grid.max())],
        "lat_range": [float(lat_grid.min()), float(lat_grid.max())],
    }

    return prob_grid, metadata


def save_candidates_geojson(candidates: dict, path: str | Path) -> None:
    """Save candidate locations to GeoJSON file."""
    with open(path, "w") as f:
        json.dump(candidates, f, indent=2)
    logger.info(f"Saved {len(candidates['features'])} candidates to {path}")
