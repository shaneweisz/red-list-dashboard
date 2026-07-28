// Shared shape of a species row as returned by /api/redlist/species and rendered
// by RedListView. (The data is fetched inline in RedListView; this module is the
// canonical type definition imported across the app.)

export interface RedListSpecies {
  id: number;
  sis_taxon_id: number | null;
  col_id?: string | null; // CoL id (on NE rows); used for the detail panel's synonyms/CoL tab
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
  // CoL species description year — populated for Not Evaluated (NE) rows only;
  // null for assessed species and for NE names with no datable CoL source.
  described_year: number | null;
  gbif_species_key: number | null;
  gbif_occurrence_count: number | null;
  gbif_observations_after_assessment_year: number | null;
  // Latest assessment's assessors/reviewers, inline in the species list (drives
  // the assessor/reviewer filter). The full history array is fetched lazily into
  // previous_assessments when a detail panel opens — empty in the list response.
  latest_assessors: string | null;
  latest_reviewers: string | null;
  previous_assessments: { id: number; year: string; category: string; date: string | null; criteria: string | null; assessors: string | null; reviewers: string | null }[];
  systems: string[];
  growth_forms: string[];
  movement_pattern: string | null;
  possibly_extinct: boolean;
  possibly_extinct_in_the_wild: boolean;
  criteria: string | null;
  threat_codes: string[];
  habitat_codes: string[];
}
