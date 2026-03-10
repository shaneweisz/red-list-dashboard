"use client";

import { useState, useEffect, useRef, useCallback } from "react";

// ── Types ────────────────────────────────────────────────────────────────

export interface DashboardSpecies {
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
  priority_score: number;
}

export interface CrossFilters {
  categories: Record<string, number>;
  years: Record<string, number>;
  countries: Record<string, number>;
  obs_ranges: Record<string, number>;
}

export interface DashboardData {
  species: DashboardSpecies[];
  total: number;
  cross_filters: CrossFilters;
  ne_count: number;
}

export interface DashboardFilters {
  taxonId: string;
  categories: string[];
  yearRanges: string[];
  countries: string[];
  search: string;
  obsRanges: string[];
  sortField: string;
  sortDirection: string;
  page: number;
  pageSize: number;
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useDashboardQuery(filters: DashboardFilters) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchDashboard = useCallback(async (f: DashboardFilters, signal: AbortSignal) => {
    const res = await fetch("/api/redlist/dashboard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxonId: f.taxonId,
        categories: f.categories.length ? f.categories : undefined,
        yearRanges: f.yearRanges.length ? f.yearRanges : undefined,
        countries: f.countries.length ? f.countries : undefined,
        search: f.search || undefined,
        obsRanges: f.obsRanges.length ? f.obsRanges : undefined,
        sortField: f.sortField,
        sortDirection: f.sortDirection,
        page: f.page,
        pageSize: f.pageSize,
      }),
      signal,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Dashboard API returned ${res.status}`);
    }

    return res.json() as Promise<DashboardData>;
  }, []);

  useEffect(() => {
    // Cancel previous in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);
    setError(null);

    fetchDashboard(filters, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
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
  }, [
    filters.taxonId,
    filters.categories.join(","),
    filters.yearRanges.join(","),
    filters.countries.join(","),
    filters.search,
    filters.obsRanges.join(","),
    filters.sortField,
    filters.sortDirection,
    filters.page,
    filters.pageSize,
    fetchDashboard,
  ]);

  return { data, isLoading, error };
}
