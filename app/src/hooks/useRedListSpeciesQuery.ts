"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export interface RedListSpecies {
  id: number;
  sis_taxon_id: number | null;
  assessment_id: number | null;
  scientific_name: string;
  common_name: string | null;
  family: string | null;
  category: string;
  assessment_date: string | null;
  year_published: string | null;
  population_trend: string | null;
  countries: string[];
  class_name: string | null;
  order_name: string | null;
  taxon_group: string;
  taxon_id: string;
  gbif_species_key: number | null;
  gbif_occurrence_count: number | null;
  gbif_observations_after_assessment_year: number | null;
  previous_assessments: { id: number; year: string; category: string; date: string | null; assessors: string | null; reviewers: string | null }[];
}

interface SpeciesResponse {
  species: RedListSpecies[];
  total: number;
  error?: string;
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Fetches all species for a given taxon from the API.
 * Only re-fetches when taxonId changes.
 */
export function useRedListSpecies(taxonId: string | null) {
  const [species, setSpecies] = useState<RedListSpecies[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current?.abort();

    // null means "don't fetch" — return empty state
    if (taxonId === null) {
      setSpecies([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetch(`/api/redlist/species?taxon=${encodeURIComponent(taxonId)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Species API returned ${res.status}`);
        }
        return res.json() as Promise<SpeciesResponse>;
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setSpecies(data.species);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [taxonId]);

  return { species, isLoading, error };
}
