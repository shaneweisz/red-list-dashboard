/**
 * GBIF taxonomy constants, shared by the sync scripts and the runtime API routes.
 *
 * GBIF relaunched gbif.org on 18 June 2026 with the Catalogue of Life Extended
 * Release (COL XR) as its default taxonomy, replacing the GBIF Backbone that had
 * organised occurrence records until then. The backbone was last updated in 2023
 * and will not be updated again.
 *
 * Two things follow, and both are why every call below names its checklist
 * explicitly rather than relying on a default:
 *
 *   1. The two taxonomies use different key spaces — backbone keys are integers
 *      (2434814), COL XR keys are alphanumeric ("43MJ7"). A key from one
 *      taxonomy resolves to nothing in the other, and GBIF answers that with an
 *      empty result set rather than an error. That is exactly how the occurrence
 *      links on this dashboard silently started reporting "0 records".
 *   2. gbif.org already defaults to COL XR, but the v1 API still defaults to the
 *      backbone. Those defaults will converge eventually. Anything that leaves
 *      `checklistKey` unset is relying on which side of that convergence it
 *      happens to be running on.
 *
 * @see https://data-blog.gbif.org/post/catalogue-of-life-taxonomic-backbone/
 */

/** Catalogue of Life Extended Release — the taxonomy this dashboard now uses throughout. */
export const COL_XR_CHECKLIST_KEY = "7ddf754f-d193-4cc9-b351-99906754a03b";

/** The legacy GBIF Backbone Taxonomy, frozen at 2023. Kept only to explain the migration. */
export const GBIF_BACKBONE_CHECKLIST_KEY = "d7dddbf4-2cf0-4f39-9b2a-bb099caae36c";

/**
 * Occurrence types this dashboard counts: georeferenced records that represent an
 * observation of a living organism in the wild. Excludes preserved/fossil/living
 * specimens (herbaria, museums, zoos) and material citations.
 */
export const INCLUDED_BASIS_OF_RECORD = [
  "HUMAN_OBSERVATION",
  "MACHINE_OBSERVATION",
  "OCCURRENCE",
  "MATERIAL_SAMPLE",
  "OBSERVATION",
] as const;

/**
 * The filter set shared by every GBIF occurrence query and outbound link, so a
 * count shown here and the search a user lands on describe the same records.
 */
export function gbifOccurrenceParams(extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams({
    checklistKey: COL_XR_CHECKLIST_KEY,
    hasCoordinate: "true",
    hasGeospatialIssue: "false",
    ...extra,
  });
  INCLUDED_BASIS_OF_RECORD.forEach((b) => params.append("basisOfRecord", b));
  return params;
}

/** Query string for an outbound gbif.org/occurrence/search link for one taxon. */
export function gbifSearchUrl(taxonKey: string, extra: Record<string, string> = {}): string {
  const params = gbifOccurrenceParams(extra);
  params.set("taxonKey", taxonKey);
  return `https://www.gbif.org/occurrence/search?${params}`;
}
