/**
 * GBIF taxonomy constants, shared by the sync scripts and the runtime API routes.
 *
 * GBIF relaunched gbif.org on 18 June 2026 with the Catalogue of Life Extended
 * Release as its default taxonomy, replacing the GBIF Backbone that had organised
 * occurrence records until then. The backbone was last updated in 2023 and will
 * not be updated again.
 *
 * The two use different key spaces — backbone keys are integers (2434814), CoL
 * keys are alphanumeric ("43MJ7") — and a key from one resolves to nothing in the
 * other. GBIF reports that as an **empty result set, not an error**, so the
 * failure is always silent: counts become 0, links land on "0 records", species
 * quietly vanish from a list.
 *
 * Which is why every request names its checklist explicitly. gbif.org already
 * defaults to CoL while the v1 API still defaults to the backbone; those defaults
 * will converge eventually, and anything leaving `checklistKey` unset is relying
 * on which side of that convergence it happens to run on.
 *
 * See docs/gbif-col-migration.md for how the pipeline moved onto CoL and why
 * GBIF, rather than a local copy of the checklist, is the authority for its keys.
 *
 * @see https://data-blog.gbif.org/post/catalogue-of-life-taxonomic-backbone/
 */

/** Catalogue of Life Extended Release — gbif.org's default taxonomy since June 2026. */
export const COL_XR_CHECKLIST_KEY = "7ddf754f-d193-4cc9-b351-99906754a03b";

/** The legacy GBIF Backbone Taxonomy, frozen at 2023. Kept to explain the move. */
export const GBIF_BACKBONE_CHECKLIST_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

/**
 * The checklist this project's stored `gbif_species_key` values belong to, and
 * therefore the one every query and link must name.
 *
 * Flipping this constant is not by itself a migration — the stored keys have to
 * change with it, or every query asks one taxonomy about another's keys and gets
 * an empty result set back. The pipeline now derives its group keys from CoL
 * (scripts/derive-gbif-taxon-keys.ts) and resolves species keys and names through
 * GBIF against this checklist, so the keys and this constant move together.
 */
export const GBIF_CHECKLIST_KEY = COL_XR_CHECKLIST_KEY;

/**
 * Occurrence types this dashboard counts: georeferenced records representing an
 * observation of a living organism in the wild. Excludes preserved, fossil and
 * living specimens (herbaria, museums, zoos) and material citations.
 */
export const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
] as const;

/**
 * Base parameters shared by every GBIF occurrence query and outbound link, so a
 * count shown here and the search a user lands on describe the same records.
 */
export function gbifOccurrenceParams(extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams({
    checklistKey: GBIF_CHECKLIST_KEY,
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    ...extra,
  });
  INCLUDED_BASIS_OF_RECORD.forEach((b) => params.append("basisOfRecord", b));
  return params;
}
