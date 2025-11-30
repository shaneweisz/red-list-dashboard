"""
GBIF API utilities for fetching species occurrence data.
"""

import requests
from typing import Optional


def get_species_key(species_name: str) -> Optional[int]:
    """
    Get GBIF taxon key for a species by name.

    Args:
        species_name: Scientific name of the species (e.g., "Quercus robur")

    Returns:
        GBIF taxon key or None if not found
    """
    url = "https://api.gbif.org/v1/species/match"
    params = {"name": species_name}

    response = requests.get(url, params=params)
    response.raise_for_status()
    data = response.json()

    if data.get("matchType") == "NONE":
        return None

    return data.get("usageKey")


def fetch_gbif_occurrences(
    taxon_key: int,
    min_lat: float,
    max_lat: float,
    min_lon: float,
    max_lon: float,
    limit: int = 300
) -> list[dict]:
    """
    Fetch occurrences from GBIF API with pagination.

    Args:
        taxon_key: GBIF taxon key for the species
        min_lat, max_lat: Latitude bounds
        min_lon, max_lon: Longitude bounds
        limit: Number of records per API request

    Returns:
        List of occurrence dictionaries
    """
    base_url = "https://api.gbif.org/v1/occurrence/search"
    all_occurrences = []
    offset = 0

    while True:
        params = {
            "taxonKey": taxon_key,
            "hasCoordinate": "true",
            "hasGeospatialIssue": "false",
            "decimalLatitude": f"{min_lat},{max_lat}",
            "decimalLongitude": f"{min_lon},{max_lon}",
            "limit": limit,
            "offset": offset
        }

        response = requests.get(base_url, params=params)
        response.raise_for_status()
        data = response.json()

        results = data.get("results", [])
        if not results:
            break

        all_occurrences.extend(results)

        if len(all_occurrences) >= data.get("count", 0):
            break

        offset += limit

    return all_occurrences


def occurrences_to_geojson(occurrences: list[dict], species_name: str) -> dict:
    """
    Convert GBIF occurrences to GeoJSON format.

    Args:
        occurrences: List of GBIF occurrence dictionaries
        species_name: Name of the species

    Returns:
        GeoJSON FeatureCollection
    """
    features = []

    for occ in occurrences:
        lat = occ.get("decimalLatitude")
        lon = occ.get("decimalLongitude")

        if lat is None or lon is None:
            continue

        feature = {
            "type": "Feature",
            "properties": {
                "name": species_name,
                "gbifID": occ.get("gbifID"),
                "occurrenceID": occ.get("occurrenceID"),
                "eventDate": occ.get("eventDate"),
                "datasetName": occ.get("datasetName"),
                "coordinateUncertaintyInMeters": occ.get("coordinateUncertaintyInMeters"),
            },
            "geometry": {
                "type": "Point",
                "coordinates": [lon, lat]
            }
        }
        features.append(feature)

    return {
        "type": "FeatureCollection",
        "name": f"{species_name.replace(' ', '_')}_occurrences",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}
        },
        "features": features
    }


def extract_coordinates(occurrences: list[dict]) -> list[tuple[float, float]]:
    """
    Extract (lon, lat) coordinates from GBIF occurrences.

    Args:
        occurrences: List of GBIF occurrence dictionaries

    Returns:
        List of (longitude, latitude) tuples
    """
    coords = []
    for occ in occurrences:
        lat = occ.get("decimalLatitude")
        lon = occ.get("decimalLongitude")
        if lat is not None and lon is not None:
            coords.append((lon, lat))
    return coords
