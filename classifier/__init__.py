"""
Species Location Classifier using Tessera Embeddings

This module provides tools to identify candidate locations for plant species
using GBIF occurrence data and Tessera geospatial foundation model embeddings.
"""

from .gbif import fetch_gbif_occurrences, occurrences_to_geojson, extract_coordinates, get_species_key
from .training import generate_negative_samples, prepare_training_data, EmbeddingManager
from .model import SpeciesClassifier, compare_models
from .predict import generate_candidate_locations, save_candidates_geojson

__all__ = [
    'fetch_gbif_occurrences',
    'occurrences_to_geojson',
    'extract_coordinates',
    'get_species_key',
    'generate_negative_samples',
    'prepare_training_data',
    'EmbeddingManager',
    'SpeciesClassifier',
    'compare_models',
    'generate_candidate_locations',
    'save_candidates_geojson',
]
