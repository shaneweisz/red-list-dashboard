#!/usr/bin/env python3
"""
Test the species classifier end-to-end with Quercus robur (Common Oak).
"""

import logging
import json
from pathlib import Path

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Import from our classifier module
from classifier.gbif import get_species_key, fetch_gbif_occurrences, extract_coordinates
from classifier.training import generate_negative_samples, prepare_training_data
from classifier.model import SpeciesClassifier, compare_models
from classifier.predict import generate_candidate_locations, save_candidates_geojson

# Configuration
SPECIES_NAME = "Quercus robur"
# Cambridge bbox (same as brambles_tessera with buffer)
# Original: lon [0.047, 0.200], lat [52.142, 52.268]
# With buffer: lon [-0.003, 0.250], lat [52.092, 52.318]
BBOX = (-0.003, 52.092, 0.250, 52.318)  # (min_lon, min_lat, max_lon, max_lat)
OUTPUT_DIR = Path("data")
CACHE_DIR = Path("data/embeddings_cache")
YEAR = 2024
SEED = 42


def main():
    logger.info("=" * 60)
    logger.info("Species Classifier Test: Quercus robur (Common Oak)")
    logger.info("=" * 60)

    # Step 1: Get GBIF data
    logger.info("[1/5] Fetching GBIF data...")
    taxon_key = get_species_key(SPECIES_NAME)
    logger.info(f"  Taxon key: {taxon_key}")

    min_lon, min_lat, max_lon, max_lat = BBOX
    occurrences = fetch_gbif_occurrences(taxon_key, min_lat, max_lat, min_lon, max_lon)
    logger.info(f"  Found {len(occurrences)} occurrences")

    positive_points = extract_coordinates(occurrences)
    logger.info(f"  Extracted {len(positive_points)} coordinate pairs")

    # Step 2: Generate negative samples
    logger.info("[2/5] Generating negative samples...")
    negative_points = generate_negative_samples(
        positive_points, n_samples=len(positive_points), bbox=BBOX, seed=SEED
    )
    logger.info(f"  Generated {len(negative_points)} negative samples")

    # Step 3: Prepare training data with Tessera embeddings
    logger.info("[3/5] Downloading Tessera embeddings and preparing training data...")

    # Create cache path for embeddings
    cache_path = CACHE_DIR / f"cambridge_{YEAR}.tif"

    X, y, valid_points, embedding_manager = prepare_training_data(
        positive_points, negative_points, bbox=BBOX, year=YEAR, cache_path=cache_path
    )
    logger.info(f"  Training data shape: X={X.shape}, y={y.shape}")
    logger.info(f"  Class balance: {y.sum()} positive, {len(y) - y.sum()} negative")

    # Step 4: Train and compare classifiers
    logger.info("[4/5] Training classifiers...")
    results = compare_models(X, y, model_types=["knn", "rf", "svm"], random_state=SEED)

    # Find best model
    best_model_type = max(results, key=lambda k: results[k]["stats"]["test_accuracy"])
    best_classifier = results[best_model_type]["classifier"]
    best_stats = results[best_model_type]["stats"]

    logger.info(f"  Best model: {best_model_type}")
    logger.info(f"  Test accuracy: {best_stats['test_accuracy']:.3f}")

    # Save best model
    model_path = OUTPUT_DIR / f"oak_{best_model_type}_model.joblib"
    best_classifier.save(model_path)
    logger.info(f"  Saved model to {model_path}")

    # Step 5: Generate candidate locations
    logger.info("[5/5] Generating candidate locations...")

    candidates = generate_candidate_locations(
        best_classifier,
        embedding_manager,
        probability_threshold=0.6,
        resolution=0.01,  # ~1km resolution for testing
    )

    candidates_path = OUTPUT_DIR / "oak_candidates.geojson"
    save_candidates_geojson(candidates, candidates_path)

    # Summary
    logger.info("=" * 60)
    logger.info("RESULTS SUMMARY")
    logger.info("=" * 60)
    logger.info(f"Species: {SPECIES_NAME}")
    logger.info(f"Region: {BBOX}")
    logger.info(f"GBIF occurrences: {len(occurrences)}")
    logger.info(f"Training samples: {len(X)} ({y.sum()} positive, {len(y) - y.sum()} negative)")
    logger.info(f"Best classifier: {best_model_type} (accuracy: {best_stats['test_accuracy']:.3f})")
    logger.info(f"Candidate locations: {len(candidates['features'])}")
    logger.info(f"Outputs saved to {OUTPUT_DIR}/")

    return results


if __name__ == "__main__":
    main()
