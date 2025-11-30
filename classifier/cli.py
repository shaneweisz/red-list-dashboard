"""
Command-line interface for the species classifier.
"""

import argparse
import json
from pathlib import Path

from .gbif import get_species_key, fetch_gbif_occurrences, occurrences_to_geojson, extract_coordinates
from .training import generate_negative_samples, prepare_training_data
from .model import SpeciesClassifier, compare_models
from .predict import generate_candidate_locations, save_candidates_geojson


def train_classifier(
    species_name: str,
    bbox: tuple[float, float, float, float],
    output_dir: Path,
    model_type: str = "rf",
    year: int = 2024,
    seed: int = 42,
) -> dict:
    """
    Complete pipeline: fetch data, train classifier, generate candidates.

    Args:
        species_name: Scientific name of the species
        bbox: (min_lon, min_lat, max_lon, max_lat)
        output_dir: Directory to save outputs
        model_type: Type of classifier to train
        year: Year for Tessera embeddings
        seed: Random seed

    Returns:
        Dictionary with results and statistics
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results = {"species": species_name, "bbox": list(bbox)}

    # Step 1: Get GBIF taxon key
    print(f"\n{'='*60}")
    print(f"Species: {species_name}")
    print(f"{'='*60}")

    taxon_key = get_species_key(species_name)
    if taxon_key is None:
        raise ValueError(f"Species not found in GBIF: {species_name}")
    print(f"GBIF taxon key: {taxon_key}")
    results["taxon_key"] = taxon_key

    # Step 2: Fetch occurrences
    print(f"\nFetching GBIF occurrences...")
    min_lon, min_lat, max_lon, max_lat = bbox
    occurrences = fetch_gbif_occurrences(
        taxon_key, min_lat, max_lat, min_lon, max_lon
    )
    print(f"Found {len(occurrences)} occurrences")
    results["n_occurrences"] = len(occurrences)

    if len(occurrences) < 5:
        raise ValueError(f"Not enough occurrences ({len(occurrences)}) to train classifier")

    # Save occurrences
    geojson = occurrences_to_geojson(occurrences, species_name)
    occ_path = output_dir / f"{species_name.replace(' ', '_').lower()}_occurrences.geojson"
    with open(occ_path, "w") as f:
        json.dump(geojson, f, indent=2)
    print(f"Saved occurrences to {occ_path}")

    # Step 3: Prepare training data
    print(f"\nPreparing training data...")
    positive_points = extract_coordinates(occurrences)
    negative_points = generate_negative_samples(
        positive_points, n_samples=len(positive_points), bbox=bbox, seed=seed
    )

    X, y, valid_points = prepare_training_data(
        positive_points, negative_points, year=year
    )
    results["n_training_samples"] = len(X)
    results["n_positive"] = int(y.sum())
    results["n_negative"] = int(len(y) - y.sum())

    # Step 4: Train classifier
    print(f"\nTraining {model_type} classifier...")
    classifier = SpeciesClassifier(model_type=model_type)
    train_stats = classifier.train(X, y, random_state=seed)

    print(f"CV Accuracy: {train_stats['cv_accuracy_mean']:.3f} (+/- {train_stats['cv_accuracy_std']*2:.3f})")
    print(f"Test Accuracy: {train_stats['test_accuracy']:.3f}")

    results["training"] = train_stats

    # Save model
    model_path = output_dir / f"{species_name.replace(' ', '_').lower()}_{model_type}_model.joblib"
    classifier.save(model_path)
    print(f"Saved model to {model_path}")

    # Step 5: Generate candidate locations
    print(f"\nGenerating candidate locations...")
    candidates = generate_candidate_locations(
        classifier, bbox, year=year, probability_threshold=0.7
    )

    candidates_path = output_dir / f"{species_name.replace(' ', '_').lower()}_candidates.geojson"
    save_candidates_geojson(candidates, candidates_path)

    results["candidates"] = candidates["metadata"]

    # Save results summary
    results_path = output_dir / f"{species_name.replace(' ', '_').lower()}_results.json"
    with open(results_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved results summary to {results_path}")

    return results


def main():
    parser = argparse.ArgumentParser(description="Train a species location classifier")
    parser.add_argument("species", help="Scientific name of the species (e.g., 'Quercus robur')")
    parser.add_argument("--min-lon", type=float, required=True, help="Minimum longitude")
    parser.add_argument("--max-lon", type=float, required=True, help="Maximum longitude")
    parser.add_argument("--min-lat", type=float, required=True, help="Minimum latitude")
    parser.add_argument("--max-lat", type=float, required=True, help="Maximum latitude")
    parser.add_argument("--output-dir", "-o", default="./output", help="Output directory")
    parser.add_argument("--model", "-m", default="rf", choices=["knn", "rf", "svm", "mlp", "lr"],
                        help="Classifier type")
    parser.add_argument("--year", "-y", type=int, default=2024, help="Year for Tessera embeddings")
    parser.add_argument("--seed", "-s", type=int, default=42, help="Random seed")

    args = parser.parse_args()

    bbox = (args.min_lon, args.min_lat, args.max_lon, args.max_lat)

    train_classifier(
        species_name=args.species,
        bbox=bbox,
        output_dir=args.output_dir,
        model_type=args.model,
        year=args.year,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
