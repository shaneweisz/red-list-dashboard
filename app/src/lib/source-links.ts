/**
 * Canonical primary-source identifiers + links for a species.
 *
 * The dashboard link an agent already gets (`dashboard_url`) is a *reproduction
 * of the agent's own filtered view* — useful for a human to eyeball, but NOT a
 * citation to a primary source. For real verifiability each species also needs
 * its canonical identifiers and the URLs they resolve to: the IUCN Red List
 * taxon/assessment page, the GBIF taxon page, and the Catalogue of Life taxon
 * page. An agent can then cite the actual assessment behind each claim, not a
 * re-run of its query.
 *
 * URL shapes mirror the ones the dashboard UI already builds (RedListView):
 *  - IUCN:  https://www.iucnredlist.org/species/{sis_taxon_id}/{assessment_id}
 *  - GBIF:  https://www.gbif.org/species/{gbif_species_key}
 *  - CoL:   https://www.catalogueoflife.org/data/taxon/{col_id}
 */

// The Red List release these assessments were synced from. Surfaced alongside
// each species' assessment_date so a citation stays meaningful as the Red List
// is revised (assessments are re-published under a new version twice a year).
// Kept in sync with the Table 1a source pinned in config/taxa.ts.
export const RED_LIST_VERSION = "2025-2";

export interface SpeciesIdentifiers {
  sis_taxon_id?: number | null;
  assessment_id?: number | null;
  gbif_species_key?: number | null;
  col_id?: string | null;
}

export interface PrimarySources {
  /** IUCN SIS taxon id (the stable id behind the Red List taxon page). */
  sis_taxon_id: number | null;
  /** The specific assessment rendered on the IUCN page (changes on reassessment). */
  assessment_id: number | null;
  gbif_species_key: number | null;
  col_id: string | null;
  /** The Red List release these fields were synced from. */
  red_list_version: string;
  /** Canonical IUCN Red List assessment page — the citable primary source. */
  iucn_url: string | null;
  /** GBIF taxon page (occurrence records, backbone taxonomy). */
  gbif_url: string | null;
  /** Catalogue of Life taxon page (accepted name + synonymy). */
  col_url: string | null;
}

/** Build the canonical primary-source identifiers + links block for a species. */
export function primarySources(s: SpeciesIdentifiers): PrimarySources {
  const sis = s.sis_taxon_id ?? null;
  const assessment = s.assessment_id ?? null;
  const gbif = s.gbif_species_key ?? null;
  const col = s.col_id ?? null;
  return {
    sis_taxon_id: sis,
    assessment_id: assessment,
    gbif_species_key: gbif,
    col_id: col,
    red_list_version: RED_LIST_VERSION,
    // The IUCN page needs both ids; without the assessment id it 404s, so emit
    // null rather than a broken link (e.g. Not-Evaluated species have neither).
    iucn_url: sis != null && assessment != null
      ? `https://www.iucnredlist.org/species/${sis}/${assessment}`
      : null,
    gbif_url: gbif != null ? `https://www.gbif.org/species/${gbif}` : null,
    col_url: col ? `https://www.catalogueoflife.org/data/taxon/${col}` : null,
  };
}
