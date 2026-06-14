/**
 * /browse — server-rendered, agent- and human-readable view of the dashboard's
 * data. The main dashboard is a client-rendered SPA (empty HTML to a crawler),
 * so this route returns real content for a pasted URL, backed by the same DuckDB
 * read layer the SPA uses.
 *
 * Two modes:
 *  - Browse a taxon: ?taxa=<name> (any curated group/sub-group) [+ base filters
 *    threats=, categories=, countries=, …] → querySpecies, then the shared
 *    matchesSpeciesFilter predicate. Answers "which corals are threatened by
 *    climate change?".
 *  - Look up a species: ?search=<name> → searchSpecies (synonym-aware: an old
 *    name resolves to the accepted species). Answers "is the tiger threatened?".
 *
 * Accepts plain-English values (threats=climate-change, categories=endangered,
 * taxa=birds, countries=Brazil), renders codes back as labels, caps results
 * (never a bulk dump). Add ?format=json for agentic clients.
 */

import { NextRequest, NextResponse } from "next/server";
import { querySpecies, searchSpecies, type SearchResult } from "@/lib/data/species-duckdb";
import { isOutdated } from "@/lib/data/species-store";
import { findNode, speciesMatchesNode } from "@/lib/taxonomy-utils";
import { matchesSpeciesFilter, type SpeciesFilterCriteria, type FilterableSpecies } from "@/lib/species-filter";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { CATEGORY_ORDER } from "@/config/taxa";
import { CACHE_1H } from "@/lib/cache-headers";
import {
  resolveTaxa, resolveThreats, resolveCategories, resolveCountries,
  taxonLabel, categoryLabel, countryLabel, threatDisplay,
  THREAT_LABEL, THREAT_CATEGORIES, FEATURED_TAXA, ALL_CATEGORIES,
  SYSTEMS, POPULATION_TRENDS,
} from "@/lib/filter-vocab";

export const revalidate = 3600;

const RESULT_CAP = 200;
const BASE = "/browse";

// The fields /browse reads for filtering + rendering. querySpecies rows
// (toSpeciesRow) satisfy this; search hits are mapped into it.
type Row = FilterableSpecies & {
  taxon_group?: string;
  class_name?: string | null;
  order_name?: string | null;
  family?: string | null;
  matched_synonym?: string | null;
};

// ─── helpers ───────────────────────────────────────────────────────────────

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const setOrUndef = (a: string[]) => (a.length ? new Set(a) : undefined);

function parseList(sp: URLSearchParams, key: string): string[] {
  return (sp.getAll(key).join(",") || "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Match free-text values case-insensitively against a fixed option list. */
function normalizeOneOf(values: string[], options: string[]): { values: string[]; unresolved: string[] } {
  const out: string[] = [];
  const unresolved: string[] = [];
  for (const v of values) {
    const hit = options.find((o) => o.toLowerCase() === v.toLowerCase());
    if (hit) out.push(hit);
    else unresolved.push(v);
  }
  return { values: out, unresolved };
}

function threatLabel(code: string): string {
  return THREAT_LABEL[code] ? `${THREAT_LABEL[code]} (${code})` : code;
}

// Map a search hit (lean SearchResult) into the render shape. Threats/systems/
// trend/obs aren't carried by search; they render as "—".
function searchHitToRow(h: SearchResult): Row {
  return {
    category: h.category,
    countries: h.countries ?? [],
    systems: null,
    population_trend: null,
    movement_pattern: null,
    threat_codes: null,
    has_map: false,
    growth_forms: null,
    scientific_name: h.scientific_name,
    common_name: h.common_name,
    gbif_occurrence_count: null,
    assessment_date: h.assessment_date,
    taxon_group: h.taxon_group,
    matched_synonym: h.matched_synonym ?? null,
  };
}

// ─── route ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = sp.get("format");

  const taxa = resolveTaxa(parseList(sp, "taxa"));
  const threats = resolveThreats(parseList(sp, "threats"));
  const categories = resolveCategories(parseList(sp, "categories"));
  const countries = resolveCountries(parseList(sp, "countries"));
  const systems = normalizeOneOf(parseList(sp, "systems"), SYSTEMS);
  const trends = normalizeOneOf(parseList(sp, "trends"), POPULATION_TRENDS);
  const movement = parseList(sp, "movement");
  const growthForms = parseList(sp, "growthForms");
  const hasMapRaw = sp.get("hasMap");
  const hasMap: "yes" | "no" | null = hasMapRaw === "yes" ? "yes" : hasMapRaw === "no" ? "no" : null;
  const search = (sp.get("search") ?? "").trim();

  const intParam = (k: string): number | undefined => {
    const v = sp.get(k);
    if (v == null) return undefined;
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? undefined : n;
  };
  const minObs = intParam("minObs");
  const maxObs = intParam("maxObs");
  const minAssessmentYear = intParam("minAssessmentYear");
  const maxAssessmentYear = intParam("maxAssessmentYear");
  const outdatedRaw = sp.get("outdated");
  const outdated: "yes" | "no" | null = outdatedRaw === "yes" ? "yes" : outdatedRaw === "no" ? "no" : null;

  const unresolved = [
    ...taxa.unresolved.map((v) => `taxa=${v}`),
    ...threats.unresolved.map((v) => `threats=${v}`),
    ...categories.unresolved.map((v) => `categories=${v}`),
    ...countries.unresolved.map((v) => `countries=${v}`),
    ...systems.unresolved.map((v) => `systems=${v}`),
    ...trends.unresolved.map((v) => `trends=${v}`),
  ];

  // No actionable selector → self-describing index.
  if (taxa.ids.length === 0 && !search) {
    return format === "json"
      ? NextResponse.json(indexData(unresolved), { headers: CACHE_1H })
      : html(indexHtml(unresolved));
  }

  const criteria: SpeciesFilterCriteria = {
    categories: setOrUndef(categories.codes),
    threats: setOrUndef(threats.codes),
    countries: setOrUndef(countries.codes),
    systems: setOrUndef(systems.values),
    populationTrends: setOrUndef(trends.values),
    movementPatterns: setOrUndef(movement),
    growthForms: setOrUndef(growthForms),
    hasMap,
    search: search ? search.toLowerCase() : undefined,
    minObs,
    maxObs,
    minAssessmentYear,
    maxAssessmentYear,
  };

  // ── Data access (DuckDB read layer) ──
  let matched: Row[] = [];
  let tooLarge = false;

  if (taxa.ids.length) {
    // Browse mode: query each taxon, narrow curated sub-nodes client-side (the read
    // layer filters only by taxon_group), then apply the shared base predicate.
    const includeNE = categories.codes.includes("NE");
    const results = await Promise.all(taxa.ids.map((id) => querySpecies({ taxon: id, includeNE })));
    const seen = new Set<number>();
    results.forEach((res, i) => {
      if (res.tooLarge) tooLarge = true;
      const id = taxa.ids[i];
      const isNode = !!findNode(id);
      // toSpeciesRow's inferred return type is loose ({}); RedListSpecies is the
      // canonical runtime shape (satisfies FilterableSpecies + node-match fields).
      for (const r of res.species as unknown as RedListSpecies[]) {
        if (isNode && !speciesMatchesNode(r, id)) continue;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        if (matchesSpeciesFilter(r, criteria)) matched.push(r);
      }
    });
    if (outdated) matched = matched.filter((r) => isOutdated(r.assessment_date ?? null) === (outdated === "yes"));
  } else {
    // Search mode: synonym-aware species lookup. Rich base filters aren't applied
    // here (the lean hit shape lacks them); steer filtered queries to ?taxa=.
    const hits = await searchSpecies(search, RESULT_CAP);
    matched = hits.map(searchHitToRow);
  }

  matched.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 99;
    const cb = CATEGORY_ORDER[b.category] ?? 99;
    return ca !== cb ? ca - cb : a.scientific_name.localeCompare(b.scientific_name);
  });

  const total = matched.length;
  const shown = matched.slice(0, RESULT_CAP);
  const breakdown: Record<string, number> = {};
  for (const r of matched) breakdown[r.category] = (breakdown[r.category] ?? 0) + 1;

  const assessed = matched.filter((r) => r.category !== "NE");
  const outdatedCount = assessed.filter((r) => isOutdated(r.assessment_date ?? null)).length;
  const outdatedPct = assessed.length ? Math.round((outdatedCount / assessed.length) * 100) : null;
  const stats = { assessed: assessed.length, outdated: outdatedCount, outdated_pct: outdatedPct };

  const interpreted = describeFilters({ taxa, threats, categories, countries, systems, trends, movement, growthForms, hasMap, search });
  if (minObs != null) interpreted.push(`GBIF observations ≥ ${minObs.toLocaleString()}`);
  if (maxObs != null) interpreted.push(`GBIF observations ≤ ${maxObs.toLocaleString()}`);
  if (minAssessmentYear != null) interpreted.push(`Assessed in or after ${minAssessmentYear}`);
  if (maxAssessmentYear != null) interpreted.push(`Assessed in or before ${maxAssessmentYear}`);
  if (outdated) interpreted.push(outdated === "yes" ? "Outdated assessments (>10 yrs old)" : "Current assessments (≤10 yrs old)");

  if (format === "json") {
    return NextResponse.json(
      {
        query: req.nextUrl.search,
        interpreted,
        unresolved,
        too_large: tooLarge,
        total,
        shown: shown.length,
        capped: total > RESULT_CAP,
        breakdown,
        stats,
        species: shown.map((s) => ({
          scientific_name: s.scientific_name,
          common_name: s.common_name,
          matched_synonym: s.matched_synonym ?? null,
          category: s.category,
          category_label: categoryLabel(s.category),
          threats: (s.threat_codes ?? []).map((c) => ({ code: c, label: threatDisplay(c) })),
          countries: s.countries,
          systems: s.systems,
          population_trend: s.population_trend,
          assessment_date: s.assessment_date,
          outdated: isOutdated(s.assessment_date ?? null),
          gbif_occurrence_count: s.gbif_occurrence_count,
        })),
      },
      { headers: CACHE_1H },
    );
  }

  return html(resultsHtml({ interpreted, unresolved, total, shown, breakdown, stats, tooLarge }));
}

// ─── rendering ─────────────────────────────────────────────────────────────

function html(body: string): NextResponse {
  return new NextResponse(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", ...CACHE_1H },
  });
}

type Resolved = {
  taxa: ReturnType<typeof resolveTaxa>;
  threats: ReturnType<typeof resolveThreats>;
  categories: ReturnType<typeof resolveCategories>;
  countries: ReturnType<typeof resolveCountries>;
  systems: { values: string[]; unresolved: string[] };
  trends: { values: string[]; unresolved: string[] };
  movement: string[];
  growthForms: string[];
  hasMap: "yes" | "no" | null;
  search: string;
};

function describeFilters(r: Resolved): string[] {
  const parts: string[] = [];
  if (r.taxa.ids.length) parts.push(`Taxa: ${r.taxa.ids.map(taxonLabel).join(", ")}`);
  if (r.threats.codes.length) parts.push(`Threats: ${r.threats.codes.map(threatLabel).join(", ")}`);
  if (r.categories.codes.length) parts.push(`Categories: ${r.categories.codes.map(categoryLabel).join(", ")}`);
  if (r.countries.codes.length) parts.push(`Countries: ${r.countries.codes.map(countryLabel).join(", ")}`);
  if (r.systems.values.length) parts.push(`Systems: ${r.systems.values.join(", ")}`);
  if (r.trends.values.length) parts.push(`Population trend: ${r.trends.values.join(", ")}`);
  if (r.movement.length) parts.push(`Movement: ${r.movement.join(", ")}`);
  if (r.growthForms.length) parts.push(`Growth forms: ${r.growthForms.join(", ")}`);
  if (r.hasMap) parts.push(`Has range map: ${r.hasMap}`);
  if (r.search) parts.push(`Name search: "${r.search}"`);
  return parts;
}

const PAGE_HEAD = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Red List Dashboard — Browse</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:#1a1a1a}
table{border-collapse:collapse;width:100%;margin:1rem 0}
th,td{border:1px solid #ddd;padding:.35rem .55rem;text-align:left;font-size:.9rem;vertical-align:top}
th{background:#f5f5f5}
code{background:#f0f0f0;padding:0 .25rem;border-radius:3px}
.summary{font-size:1.05rem}
.warn{color:#a33;background:#fee;padding:.5rem .75rem;border-radius:4px}
a{color:#0b6}
footer{margin-top:2rem;font-size:.85rem;color:#666}
</style></head><body>`;
const PAGE_FOOT = `<footer>Data: IUCN Red List + GBIF + Catalogue of Life. See <a href="/llms.txt">/llms.txt</a> for the full query vocabulary. Results are capped at ${RESULT_CAP}; this view is for browsing, not bulk download.</footer></body></html>`;

function unresolvedBlock(unresolved: string[]): string {
  if (!unresolved.length) return "";
  return `<p class="warn">Couldn't interpret: ${unresolved.map((u) => `<code>${esc(u)}</code>`).join(", ")}. See <a href="/llms.txt">/llms.txt</a> for valid values.</p>`;
}

type Stats = { assessed: number; outdated: number; outdated_pct: number | null };

function resultsHtml(a: { interpreted: string[]; unresolved: string[]; total: number; shown: Row[]; breakdown: Record<string, number>; stats: Stats; tooLarge: boolean }): string {
  const { interpreted, unresolved, total, shown, breakdown, stats, tooLarge } = a;
  const filterDesc = interpreted.length ? esc(interpreted.join("; ")) : "no filters";
  const breakdownStr = Object.entries(breakdown)
    .sort((x, y) => (CATEGORY_ORDER[x[0]] ?? 99) - (CATEGORY_ORDER[y[0]] ?? 99))
    .map(([c, n]) => `${esc(categoryLabel(c))}: ${n}`)
    .join(" · ");

  let summary: string;
  if (tooLarge && total === 0) {
    summary = `<p class="summary">That group is too large to list at once — ${filterDesc}.</p>
      <p>Open a narrower sub-group (e.g. a class, order, or family). See <a href="/llms.txt">/llms.txt</a>.</p>`;
  } else if (total === 0) {
    summary = `<p class="summary"><strong>No species match</strong> — ${filterDesc}.</p>
      <p>Try removing a filter, or see <a href="/llms.txt">/llms.txt</a> for valid values.</p>`;
  } else {
    summary = `<p class="summary"><strong>${total.toLocaleString()}</strong> species match — ${filterDesc}.${total > shown.length ? ` Showing the first ${shown.length}.` : ""}</p>`;
    if (breakdownStr) summary += `<p>By category: ${breakdownStr}</p>`;
    if (stats.assessed > 0 && stats.outdated_pct != null) {
      summary += `<p>Assessments outdated (>10 yrs old): <strong>${stats.outdated.toLocaleString()}</strong> of ${stats.assessed.toLocaleString()} (<strong>${stats.outdated_pct}%</strong>).</p>`;
    }
  }

  const rows = shown
    .map((s) => {
      const name = s.matched_synonym
        ? `<em>${esc(s.scientific_name)}</em> <span style="color:#888">(syn. ${esc(s.matched_synonym)})</span>`
        : `<em>${esc(s.scientific_name)}</em>`;
      const threats = [...new Set((s.threat_codes ?? []).map(threatDisplay))].map(esc).join(", ");
      const year = s.assessment_date ? esc(s.assessment_date.slice(0, 4)) : "—";
      const obs = s.gbif_occurrence_count != null ? s.gbif_occurrence_count.toLocaleString() : "—";
      return `<tr><td>${name}</td><td>${esc(s.common_name ?? "")}</td><td>${esc(categoryLabel(s.category))}</td><td>${year}</td><td>${obs}</td><td>${threats}</td></tr>`;
    })
    .join("");
  const table = shown.length
    ? `<table><thead><tr><th>Scientific name</th><th>Common name</th><th>IUCN category</th><th>Assessed</th><th>GBIF obs.</th><th>Threats</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";

  return `${PAGE_HEAD}<h1>Red List — filtered species</h1>${unresolvedBlock(unresolved)}${summary}${table}${PAGE_FOOT}`;
}

function indexData(unresolved: string[]) {
  return {
    description: "Server-rendered view of the Red List dashboard. Two modes: browse a taxon (taxa=…, with optional base filters) or look up a species by name (search=…, synonym-aware). Values may be codes or plain-English names. Results capped, with a total count.",
    unresolved,
    params: {
      taxa: FEATURED_TAXA.map((id) => ({ id, label: taxonLabel(id) })),
      threats: THREAT_CATEGORIES.map((t) => ({ code: t.code, label: t.label })),
      categories: ALL_CATEGORIES.map((c) => ({ code: c, label: categoryLabel(c) })),
      systems: SYSTEMS,
      trends: POPULATION_TRENDS,
      hasMap: ["yes", "no"],
      search: "free-text scientific or common name (incl. synonyms / old names)",
      outdated: "yes | no (assessment >10 years old)",
      minObs: "min GBIF occurrence count (e.g. 100)",
      maxObs: "max GBIF occurrence count",
      minAssessmentYear: "earliest assessment year (e.g. 2015)",
      maxAssessmentYear: "latest assessment year",
    },
    note: "taxa accepts any taxonomic rank — a curated group (birds, corals), a sub-group (sharks-rays, flatworms), or a scientific name (felidae, odonata). Every response includes a `stats` object (assessed/outdated/outdated_pct) for percentage questions.",
    examples: EXAMPLES,
  };
}

const EXAMPLES: { url: string; desc: string }[] = [
  { url: `${BASE}?taxa=corals&threats=climate-change`, desc: "Coral species threatened by climate change" },
  { url: `${BASE}?taxa=corals&threats=11&categories=CR,EN`, desc: "Critically endangered / endangered corals hit by climate change" },
  { url: `${BASE}?taxa=mammals`, desc: "All mammals — read stats.outdated_pct for % of outdated assessments" },
  { url: `${BASE}?taxa=mammals&categories=critically-endangered&trends=Decreasing`, desc: "Critically endangered mammals with declining populations" },
  { url: `${BASE}?search=tiger`, desc: "Look up a species by name" },
  { url: `${BASE}?search=Felis+jubata`, desc: "Look up by an old name — resolves to the accepted species" },
];

function indexHtml(unresolved: string[]): string {
  const taxaList = FEATURED_TAXA.map((id) => `<code>${esc(id)}</code> (${esc(taxonLabel(id))})`).join(", ");
  const threatList = THREAT_CATEGORIES.map((t) => `<code>${t.code}</code> ${esc(t.label)}`).join(", ");
  const catList = ALL_CATEGORIES.map((c) => `<code>${c}</code> ${esc(categoryLabel(c))}`).join(", ");
  const examples = EXAMPLES.map((e) => `<li><a href="${esc(e.url)}">${esc(e.url)}</a> — ${esc(e.desc)}</li>`).join("");

  return `${PAGE_HEAD}<h1>Red List Dashboard — Browse</h1>
${unresolvedBlock(unresolved)}
<p>Answer questions about IUCN Red List species (with GBIF + Catalogue of Life data) from a single URL. Two ways in:</p>
<ul>
<li><strong>Browse a taxon</strong>: <code>?taxa=&lt;name&gt;</code> + optional filters. <code>taxa</code> works at <em>any rank</em> — a group (<code>birds</code>, <code>corals</code>), a sub-group (<code>sharks-rays</code>, <code>flatworms</code>), or a scientific name (<code>felidae</code>, <code>odonata</code>).</li>
<li><strong>Look up a species</strong>: <code>?search=&lt;name&gt;</code> — scientific or common name, including <em>synonyms / old names</em> (they resolve to the accepted species).</li>
</ul>
<p>Values can be codes <em>or</em> plain-English names. Add <code>&amp;format=json</code> for JSON. Within one filter, comma-separated values are OR; across filters they are AND. Threats match by prefix (<code>11</code> covers <code>11.1</code>, <code>11.4</code>, …).</p>
<h2>Filters (combine with <code>taxa</code>)</h2>
<p><strong>taxa</strong>: ${taxaList} — or any sub-group / scientific name.</p>
<p><strong>threats</strong>: ${threatList} — plus aliases like <code>climate-change</code>, <code>pollution</code>, <code>overfishing</code>.</p>
<p><strong>categories</strong>: ${catList} — plus <code>threatened</code> (= CR, EN, VU).</p>
<p><strong>systems</strong>: ${SYSTEMS.map((s) => `<code>${s}</code>`).join(", ")}. <strong>trends</strong>: ${POPULATION_TRENDS.map((s) => `<code>${s}</code>`).join(", ")}. <strong>hasMap</strong>: <code>yes</code>/<code>no</code>. <strong>countries</strong>: ISO code or name.</p>
<p><strong>outdated</strong>: <code>yes</code>/<code>no</code> (assessment &gt;10 yrs old). <strong>minObs</strong>/<strong>maxObs</strong>, <strong>minAssessmentYear</strong>/<strong>maxAssessmentYear</strong>: numeric bounds.</p>
<p>Every response leads with a total, a by-category breakdown, and an outdated count + %, so percentage questions are answered in one request.</p>
<h2>Examples</h2><ul>${examples}</ul>
${PAGE_FOOT}`;
}
