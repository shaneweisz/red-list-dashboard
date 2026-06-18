/**
 * Single source of truth for turning a /browse + MCP query (`BrowseInput`) into
 * the interactive dashboard URL that reproduces the SAME species set.
 *
 * The MCP tools and the /browse route answer from `runBrowseQuery`; this builds
 * the `/?…` link a human opens to verify that answer in the dashboard. To make
 * "the agent and the human see the same view" a guarantee rather than a hope,
 * every filter maps to a dashboard URL param that feeds the *same* filter
 * predicate the dashboard already runs (see useFilterParams.parseParams +
 * RedListView). It resolves values the same way runBrowseQuery does (via the
 * shared filter-vocab resolvers), so the two can't drift.
 *
 * Mapping notes (where the two vocabularies differ):
 *  - `region` → expanded to its `countries` (the dashboard stores a region AS its
 *    country set and re-derives the region chip), so it's lossless.
 *  - `outdated`, `minObs`/`maxObs`, `minAssessmentYear`/`maxAssessmentYear`,
 *    `minDescribedYear`/`maxDescribedYear` → emitted as exact URL params. The
 *    dashboard's on-screen charts use coarse buckets; these URL-only params feed
 *    the exact same numeric/`isOutdated` predicate so the result is identical.
 *  - a curated sub-group taxon (e.g. `sharks-rays`) → `subgroups=<id>` plus its
 *    display-root in `taxa` (the dashboard filters sub-groups out of the parent's
 *    loaded set); a scientific-rank taxon (e.g. `felidae`) → `taxa=<id>` (matched
 *    by class/order/family); a featured group → `taxa=<id>`.
 *  - `assessors`/`reviewers`: both surfaces case-insensitively SUBSTRING-match the
 *    name (the dashboard predicate mirrors /browse), so a partial name selects the
 *    same species set in each.
 */
import type { BrowseInput } from "@/lib/browse-query";
import {
  resolveTaxa, resolveCategories, resolveThreats, resolveCountries,
} from "@/lib/filter-vocab";
import { resolveRegions } from "@/lib/regions";
import { findNode, getViewRootForNode } from "@/lib/taxonomy-utils";

const arr = (a?: string[]) => (a ?? []).map((s) => s.trim()).filter(Boolean);

// Split resolved taxon ids into the dashboard's `taxa` (display roots + arbitrary
// scientific ranks) vs `subgroups` (a curated node below a display root, which
// also needs its root selected so the parent's species load).
function splitTaxa(ids: string[]): { taxa: string[]; subgroups: string[] } {
  const taxa = new Set<string>();
  const subgroups = new Set<string>();
  for (const id of ids) {
    if (!findNode(id)) { taxa.add(id); continue; } // arbitrary scientific rank
    const root = getViewRootForNode(id);
    if (root && root !== id) { subgroups.add(id); taxa.add(root); }
    else taxa.add(id); // a display root (or a node outside the default view)
  }
  return { taxa: [...taxa], subgroups: [...subgroups] };
}

/**
 * Build the dashboard query string (`?…`, or `""` when nothing resolved) that
 * reproduces `input`'s species set in the interactive dashboard at `/`.
 */
export function browseInputToDashboardQuery(input: BrowseInput): string {
  const p = new URLSearchParams();

  if (input.search && input.search.trim()) {
    // Species lookup → name search (substring on scientific/common name).
    p.set("search", input.search.trim());
  }

  const taxaIds = resolveTaxa(arr(input.taxa)).ids;
  if (taxaIds.length) {
    const { taxa, subgroups } = splitTaxa(taxaIds);
    if (taxa.length) p.set("taxa", taxa.join(","));
    if (subgroups.length) p.set("subgroups", subgroups.join(","));
  }

  const categories = resolveCategories(arr(input.categories)).codes;
  if (categories.length) p.set("categories", categories.join(","));

  const threats = resolveThreats(arr(input.threats)).codes;
  if (threats.length) p.set("threats", threats.join(","));

  // Countries + region (region expands to its country set — lossless).
  const countries = new Set<string>([
    ...resolveCountries(arr(input.countries)).codes,
    ...resolveRegions(arr(input.region)).codes,
  ]);
  if (countries.size) p.set("countries", [...countries].join(","));

  const systems = arr(input.systems);
  if (systems.length) p.set("systems", systems.join(","));

  const trends = arr(input.trends);
  if (trends.length) p.set("trends", trends.join(","));

  const movement = arr(input.movement);
  if (movement.length) p.set("movement", movement.join(","));

  const growthForms = arr(input.growthForms);
  if (growthForms.length) p.set("growthForms", growthForms.join(","));

  if (input.hasMap === "yes" || input.hasMap === "no") p.set("hasMap", input.hasMap);

  const assessors = arr(input.assessors);
  if (assessors.length) p.set("assessors", assessors.join("|"));
  const reviewers = arr(input.reviewers);
  if (reviewers.length) p.set("reviewers", reviewers.join("|"));

  // Exact numeric / outdated params (URL-only; feed the same predicate the
  // dashboard runs, so the result matches the bucket-free /browse query).
  if (input.outdated === "yes" || input.outdated === "no") p.set("outdated", input.outdated);
  if (input.minObs != null) p.set("minObs", String(input.minObs));
  if (input.maxObs != null) p.set("maxObs", String(input.maxObs));
  if (input.minAssessmentYear != null) p.set("minAssessmentYear", String(input.minAssessmentYear));
  if (input.maxAssessmentYear != null) p.set("maxAssessmentYear", String(input.maxAssessmentYear));
  if (input.minDescribedYear != null) p.set("minDescribedYear", String(input.minDescribedYear));
  if (input.maxDescribedYear != null) p.set("maxDescribedYear", String(input.maxDescribedYear));

  const qs = p.toString();
  return qs ? `?${qs}` : "";
}

/** Absolute dashboard URL for `input`, given the request origin (e.g. https://host). */
export function browseInputToDashboardUrl(origin: string, input: BrowseInput): string {
  return `${origin}/${browseInputToDashboardQuery(input)}`;
}
