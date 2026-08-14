/**
 * The dashboard's row key for a species — one concept, two namespaces.
 *
 * A species reaches the dashboard through one of exactly two identity systems,
 * and which one it has is a fact about the species, not about the view:
 *
 *   - IUCN-assessed  → `sis-<sis_taxon_id>`  (SIS taxon id; every assessed row
 *                       has one, unique across assessed.parquet)
 *   - Not Evaluated  → `col-<col_id>`        (Catalogue of Life id; the NE list
 *                       IS the CoL universe, one row per col_id by construction)
 *
 * Neither id can serve for both. 823 assessed species have no CoL link at all
 * (build-matching leaves them unmatched), so col_id is not universal; NE species
 * have no assessment, so sis is not either. Namespacing them into one string key
 * is what lets every consumer — row identity, selection, pinning, caches, the
 * `species=` URL param — hold a single value with no branching.
 *
 * What this replaces
 * ------------------
 * Previously the row key was a *number* carrying the same information as a sign
 * trick: positive = sis id, negative = a hash of the CoL id. That forced every
 * consumer to know which view it was in (`isNewAssessments ? Math.abs(s.id) :
 * s.sis_taxon_id`) and, worse, there were two different hash functions for the
 * negative case — a DuckDB `hash(gbif_species_key)` baked into unassessed.parquet
 * and a JS 31-hash (`colIdToSearchId`) in the query layer. The same NE species
 * got a different id depending on which query produced the row, so selecting an
 * NE species from the search bar could not match the row in the table (the
 * `species=` param it wrote never equalled any row's key). Keys are strings now:
 * the sign trick, both hashes, and every `Math.abs` around them are gone.
 *
 * The numeric ids themselves are untouched — `sis_taxon_id` still addresses IUCN
 * assessments, range maps and AOH layers; `col_id` still addresses CoL synonymy.
 * Only the *row key* changed.
 */

/** `sis-<n>` for an assessed species, `col-<id>` for a Not Evaluated one. */
export type SpeciesRowKey = string;

/**
 * Hyphen rather than the more conventional colon: `URLSearchParams` percent-encodes
 * `:` but leaves `-` alone, so `?species=col-6CX6F` stays readable in the address
 * bar (and in a shared link) instead of becoming `?species=col%3A6CX6F`. CoL ids are
 * uppercase alphanumeric, so a hyphen can't be ambiguous with the id that follows.
 */
export const sisRowKey = (sisTaxonId: number | string): SpeciesRowKey => `sis-${sisTaxonId}`;
export const colRowKey = (colId: string): SpeciesRowKey => `col-${colId}`;

/**
 * The row key for a species row, from whichever identity it has. Assessed wins when
 * a row somehow carries both (an assessed row's col_id is only ever informational —
 * the detail panel's CoL/synonyms tab uses it), so a species never changes key when
 * a CoL link is added or removed by a resync.
 *
 * Null only for a row with neither id, which the table cannot address; callers
 * treat that as "not selectable" rather than inventing a key for it.
 */
export function speciesRowKey(row: {
  sis_taxon_id?: number | null;
  col_id?: string | null;
}): SpeciesRowKey | null {
  if (row.sis_taxon_id != null) return sisRowKey(row.sis_taxon_id);
  if (row.col_id) return colRowKey(row.col_id);
  return null;
}

export type ParsedRowKey =
  | { kind: "sis"; sisTaxonId: number }
  | { kind: "col"; colId: string };

/** Inverse of the builders above; null for anything not in either namespace. */
export function parseSpeciesRowKey(key: string | null | undefined): ParsedRowKey | null {
  if (!key) return null;
  if (key.startsWith("sis-")) {
    const n = Number(key.slice(4));
    return Number.isFinite(n) && n > 0 ? { kind: "sis", sisTaxonId: n } : null;
  }
  if (key.startsWith("col-")) {
    const colId = key.slice(4);
    return colId ? { kind: "col", colId } : null;
  }
  return null;
}

/**
 * Read the `species=` URL param, accepting the pre-namespace numeric form.
 *
 * A bare positive integer was a SIS id and still resolves exactly — that covers
 * every shared link to an assessed species, which is all of them that were stable.
 * A bare negative integer was the synthetic hash, which no longer exists in any
 * form that can be inverted (it was a one-way hash of the CoL id, and of two
 * different hash functions at that); those resolve to null, so the view loads
 * normally with no row expanded rather than silently opening the wrong species.
 */
export function parseSpeciesParam(raw: string | null | undefined): SpeciesRowKey | null {
  if (!raw) return null;
  if (/^-?\d+$/.test(raw)) {
    const n = Number(raw);
    return n > 0 ? sisRowKey(n) : null;
  }
  return parseSpeciesRowKey(raw) ? raw : null;
}

/**
 * Migrate a persisted pin list (localStorage held `number[]` before namespacing).
 * Positive entries were SIS ids; negative entries were the un-invertible hash and
 * are dropped, so a user's pinned assessed species survive and pinned NE species
 * are lost rather than resurfacing as the wrong row.
 */
export function migratePinnedSpecies(stored: unknown): SpeciesRowKey[] {
  if (!Array.isArray(stored)) return [];
  const keys: SpeciesRowKey[] = [];
  for (const entry of stored) {
    if (typeof entry === "number") {
      if (entry > 0) keys.push(sisRowKey(entry));
    } else if (typeof entry === "string" && parseSpeciesRowKey(entry)) {
      keys.push(entry);
    }
  }
  return keys;
}
