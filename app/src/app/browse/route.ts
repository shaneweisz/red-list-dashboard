/**
 * /browse — server-rendered, LLM- and human-readable view of the dashboard's
 * base filters. The main dashboard is a client-rendered SPA (empty HTML to a
 * crawler), so this route returns real content for a pasted URL.
 *
 * Mirrors the dashboard's own filter-param vocabulary, accepts plain-English
 * values (threats=climate-change, categories=endangered, taxa=birds,
 * countries=Brazil), renders codes back as labels, and is capped (never a bulk
 * dump). Add ?format=json for agentic clients.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSpecies, searchSpecies, type SpeciesRow } from "@/lib/data/species-store";
import { getCsvGroupsForNode, speciesMatchesNode } from "@/lib/taxonomy-utils";
import { matchesSpeciesFilter, type SpeciesFilterCriteria } from "@/lib/species-filter";
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

  const unresolved = [
    ...taxa.unresolved.map((v) => `taxa=${v}`),
    ...threats.unresolved.map((v) => `threats=${v}`),
    ...categories.unresolved.map((v) => `categories=${v}`),
    ...countries.unresolved.map((v) => `countries=${v}`),
    ...systems.unresolved.map((v) => `systems=${v}`),
    ...trends.unresolved.map((v) => `trends=${v}`),
  ];

  // No actionable selector → self-describing index (never a 280k scan).
  if (taxa.ids.length === 0 && !search) {
    return format === "json"
      ? NextResponse.json(indexData(unresolved), { headers: CACHE_1H })
      : html(indexHtml(unresolved));
  }

  // Resolve which CSV groups to load.
  let groups: string[];
  if (taxa.ids.length) {
    groups = [...new Set(taxa.ids.flatMap(getCsvGroupsForNode))];
  } else {
    // Search-only: narrow to the taxon groups the search index says contain hits.
    // Use a generous limit since we only need the distinct groups, not the rows.
    const hits = searchSpecies(search, 1000);
    groups = [...new Set(hits.map((h) => h.taxon_group))];
  }

  const includeNE = categories.codes.includes("NE");
  let rows: SpeciesRow[] = groups.length ? getSpecies(groups, includeNE) : [];
  // When specific taxa nodes were requested, narrow to them (no-op for top-level
  // groups; correctly narrows subgroups like sharks-rays).
  if (taxa.ids.length) {
    rows = rows.filter((r) => taxa.ids.some((id) => speciesMatchesNode(r, id)));
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
  };

  const matched = rows.filter((r) => matchesSpeciesFilter(r, criteria));
  matched.sort((a, b) => {
    const ca = CATEGORY_ORDER[a.category] ?? 99;
    const cb = CATEGORY_ORDER[b.category] ?? 99;
    return ca !== cb ? ca - cb : a.scientific_name.localeCompare(b.scientific_name);
  });

  const total = matched.length;
  const shown = matched.slice(0, RESULT_CAP);

  const breakdown: Record<string, number> = {};
  for (const r of matched) breakdown[r.category] = (breakdown[r.category] ?? 0) + 1;

  const interpreted = describeFilters({ taxa, threats, categories, countries, systems, trends, movement, growthForms, hasMap, search });

  if (format === "json") {
    return NextResponse.json(
      {
        query: req.nextUrl.search,
        interpreted,
        unresolved,
        total,
        shown: shown.length,
        capped: total > RESULT_CAP,
        breakdown,
        species: shown.map((s) => ({
          scientific_name: s.scientific_name,
          common_name: s.common_name,
          category: s.category,
          category_label: categoryLabel(s.category),
          threats: (s.threat_codes ?? []).map((c) => ({ code: c, label: threatDisplay(c) })),
          countries: s.countries,
          systems: s.systems,
          population_trend: s.population_trend,
        })),
      },
      { headers: CACHE_1H },
    );
  }

  return html(resultsHtml({ interpreted, unresolved, total, shown, breakdown }));
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
const PAGE_FOOT = `<footer>Data: IUCN Red List + GBIF. See <a href="/llms.txt">/llms.txt</a> for the full query vocabulary. Results are capped at ${RESULT_CAP}; this view is for browsing, not bulk download.</footer></body></html>`;

function unresolvedBlock(unresolved: string[]): string {
  if (!unresolved.length) return "";
  return `<p class="warn">Couldn't interpret: ${unresolved.map((u) => `<code>${esc(u)}</code>`).join(", ")}. See <a href="/llms.txt">/llms.txt</a> for valid values.</p>`;
}

function resultsHtml(a: { interpreted: string[]; unresolved: string[]; total: number; shown: SpeciesRow[]; breakdown: Record<string, number> }): string {
  const { interpreted, unresolved, total, shown, breakdown } = a;
  const filterDesc = interpreted.length ? esc(interpreted.join("; ")) : "no filters";
  const breakdownStr = Object.entries(breakdown)
    .sort((x, y) => (CATEGORY_ORDER[x[0]] ?? 99) - (CATEGORY_ORDER[y[0]] ?? 99))
    .map(([c, n]) => `${esc(categoryLabel(c))}: ${n}`)
    .join(" · ");

  let summary: string;
  if (total === 0) {
    summary = `<p class="summary"><strong>No species match</strong> — ${filterDesc}.</p>
      <p>Try removing a filter, or see <a href="/llms.txt">/llms.txt</a> for valid values.</p>`;
  } else {
    summary = `<p class="summary"><strong>${total.toLocaleString()}</strong> species match — ${filterDesc}.${total > shown.length ? ` Showing the first ${shown.length}.` : ""}</p>`;
    if (breakdownStr) summary += `<p>By category: ${breakdownStr}</p>`;
  }

  const rows = shown
    .map((s) => {
      const threats = [...new Set((s.threat_codes ?? []).map(threatDisplay))].map(esc).join(", ");
      return `<tr><td><em>${esc(s.scientific_name)}</em></td><td>${esc(s.common_name ?? "")}</td><td>${esc(categoryLabel(s.category))}</td><td>${threats}</td></tr>`;
    })
    .join("");
  const table = shown.length
    ? `<table><thead><tr><th>Scientific name</th><th>Common name</th><th>IUCN category</th><th>Threats</th></tr></thead><tbody>${rows}</tbody></table>`
    : "";

  return `${PAGE_HEAD}<h1>Red List — filtered species</h1>${unresolvedBlock(unresolved)}${summary}${table}${PAGE_FOOT}`;
}

function indexData(unresolved: string[]) {
  return {
    description: "Server-rendered view of the Red List dashboard's base filters. Combine query params on /browse; values may be codes or plain-English names. Results capped, with a total count. Pick at least one `taxa` (or a `search` term).",
    unresolved,
    params: {
      taxa: FEATURED_TAXA.map((id) => ({ id, label: taxonLabel(id) })),
      threats: THREAT_CATEGORIES.map((t) => ({ code: t.code, label: t.label })),
      categories: ALL_CATEGORIES.map((c) => ({ code: c, label: categoryLabel(c) })),
      systems: SYSTEMS,
      trends: POPULATION_TRENDS,
      hasMap: ["yes", "no"],
      search: "free-text scientific or common name",
    },
    examples: EXAMPLES,
  };
}

const EXAMPLES: { url: string; desc: string }[] = [
  { url: `${BASE}?taxa=corals&threats=climate-change`, desc: "Coral species threatened by climate change" },
  { url: `${BASE}?taxa=corals&threats=11&categories=CR,EN`, desc: "Critically endangered / endangered corals hit by climate change" },
  { url: `${BASE}?taxa=amphibia&threats=invasive-species`, desc: "Amphibians threatened by invasive species & disease" },
  { url: `${BASE}?taxa=mammalia&categories=critically-endangered&trends=Decreasing`, desc: "Critically endangered mammals with declining populations" },
  { url: `${BASE}?taxa=fishes&systems=Freshwater&threats=dams`, desc: "Freshwater fish threatened by dams & water management" },
  { url: `${BASE}?search=tiger`, desc: "Look up a species by name" },
];

function indexHtml(unresolved: string[]): string {
  const taxaList = FEATURED_TAXA.map((id) => `<code>${esc(id)}</code> (${esc(taxonLabel(id))})`).join(", ");
  const threatList = THREAT_CATEGORIES.map((t) => `<code>${t.code}</code> ${esc(t.label)}`).join(", ");
  const catList = ALL_CATEGORIES.map((c) => `<code>${c}</code> ${esc(categoryLabel(c))}`).join(", ");
  const examples = EXAMPLES.map((e) => `<li><a href="${esc(e.url)}">${esc(e.url)}</a> — ${esc(e.desc)}</li>`).join("");

  return `${PAGE_HEAD}<h1>Red List Dashboard — Browse</h1>
${unresolvedBlock(unresolved)}
<p>Filter IUCN Red List species (with GBIF links) by combining query parameters on <code>/browse</code>. Values can be codes <em>or</em> plain-English names. Pick at least one <code>taxa</code> value (or a <code>search</code> term). Add <code>&amp;format=json</code> for JSON.</p>
<p>Within one filter, multiple comma-separated values are OR; across filters they are AND. Threats match by prefix (<code>11</code> covers <code>11.1</code>, <code>11.4</code>, …).</p>
<h2>Filters</h2>
<p><strong>taxa</strong>: ${taxaList}</p>
<p><strong>threats</strong>: ${threatList} — plus aliases like <code>climate-change</code>, <code>pollution</code>, <code>overfishing</code>.</p>
<p><strong>categories</strong>: ${catList} — plus <code>threatened</code> (= CR, EN, VU).</p>
<p><strong>systems</strong>: ${SYSTEMS.map((s) => `<code>${s}</code>`).join(", ")}. <strong>trends</strong>: ${POPULATION_TRENDS.map((s) => `<code>${s}</code>`).join(", ")}. <strong>hasMap</strong>: <code>yes</code>/<code>no</code>. <strong>search</strong>: name text.</p>
<h2>Examples</h2><ul>${examples}</ul>
${PAGE_FOOT}`;
}
