/**
 * Remote MCP server for the Red List dashboard — structured tool access to the same
 * data the /browse endpoint exposes, for agents (Claude Code, claude.ai connectors,
 * ChatGPT). MCP tool calls bypass the two walls that break direct fetching from an
 * agent sandbox: they're not subject to web_fetch's verbatim-URL allowlist, and they
 * originate off the sandbox (no egress allowlist). Tools call runBrowseQuery directly
 * — the same logic /browse uses, so results are identical.
 *
 * Served at /api/mcp (streamable HTTP). mcp-handler matches the request pathname
 * against `${basePath}/mcp`, so a static `api/mcp` route is all that's needed — no
 * dynamic `[transport]` segment (its brackets are a glob char-class that breaks the
 * next.config tracing keys, bundling all of data/ and blowing the function-size cap).
 *
 * Unauthenticated — the same read-only data is already public via /browse, so a token
 * would guard nothing it doesn't, while blocking claude.ai web connectors (which speak
 * OAuth, not static bearers). If abuse becomes a concern, rate-limit instead.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import { runBrowseQuery, type BrowseInput, type BrowseResult, type BrowseSpecies } from "@/lib/browse-query";
import { browseInputToDashboardUrl } from "@/lib/dashboard-url";
import { primarySources, RED_LIST_VERSION } from "@/lib/source-links";
import {
  FEATURED_TAXA, THREAT_CATEGORIES, ALL_CATEGORIES,
  taxonLabel, categoryLabel, SYSTEMS, POPULATION_TRENDS,
} from "@/lib/filter-vocab";
import { IUCN_REGION_ORDER } from "@/lib/regions";

export const maxDuration = 60;

const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

// Per-request origin (e.g. https://host), captured from the incoming request so
// the dashboard links we emit point at THIS deployment — same approach as the
// /browse and /llms.txt routes.
const originStore = new AsyncLocalStorage<string>();
const getOrigin = () => originStore.getStore() ?? "";

// Standing instruction attached to every queryable result: the deterministic
// dashboard link plus a nudge to surface it and have the user verify. We compute
// it server-side (not via tool-prompt) so it can't be skipped by the agent.
const VERIFY_NOTE =
  "Always show `dashboard_url` to the user and encourage them to open it to inspect and verify the data themselves. It is the interactive dashboard pre-filtered to this exact query, so it reproduces the same species set you see here.";

// Labels the two distinct kinds of link we return, so an agent doesn't mistake a
// reproduce-my-view link for a primary-source citation (a real gap in the old
// dashboard_url-only response).
const SOURCES_NOTE = {
  dashboard_url: "REPRODUCE-THIS-VIEW link — the interactive dashboard pre-filtered to this exact query. For a human to inspect/verify. NOT a citation: it re-runs your filter, it doesn't point at a primary source.",
  primary_sources: "PRIMARY-SOURCE citations — each species carries `primary_sources` with its canonical ids (sis_taxon_id, assessment_id, gbif_species_key, col_id) and the URLs they resolve to (IUCN assessment page, GBIF taxon, Catalogue of Life). Cite these for individual species claims. `red_list_version` pins the Red List release.",
};

type Verbosity = "summary" | "compact" | "full";

// Project a species to the requested verbosity. Default `compact` drops the full
// per-species country array (replaced by `country_count`) and the rarely-needed
// fields, cutting payloads by ~an order of magnitude vs. the old always-full shape,
// while keeping the citable `primary_sources` block. `full` restores everything.
function shapeSpecies(s: BrowseSpecies, v: Verbosity, hasGeoFilter: boolean) {
  const base: Record<string, unknown> = {
    scientific_name: s.scientific_name,
    common_name: s.common_name,
    category: s.category,
    category_label: s.category_label,
    population_trend: s.population_trend,
    outdated: s.outdated,
  };
  if (s.matched_synonym) base.matched_synonym = s.matched_synonym;
  if (hasGeoFilter) base.endemic_to_query = s.endemic_to_query;
  if (v === "summary") return base;
  const compact = {
    ...base,
    assessment_date: s.assessment_date,
    gbif_occurrence_count: s.gbif_occurrence_count,
    country_count: s.country_count,
    threats: s.threats,
    primary_sources: primarySources(s),
  };
  if (v === "compact") return compact;
  return { ...compact, countries: s.countries, systems: s.systems }; // full
}

// Shape a BrowseResult into the MCP response body (sans the standing link/source
// blocks, which `reply` adds). `countOnly` omits the species list entirely — for
// "how many threatened X" questions where the aggregates are the whole answer.
function shapeResult(input: BrowseInput, r: BrowseResult, v: Verbosity, countOnly: boolean): Record<string, unknown> {
  const hasGeoFilter = (input.countries?.length ?? 0) > 0 || (input.region?.length ?? 0) > 0;
  const out: Record<string, unknown> = {
    total: r.total,
    breakdown: r.breakdown,
    stats: r.stats,
    interpreted: r.interpreted,
  };
  if (r.unresolved.length) out.unresolved = r.unresolved;
  if (r.narrowingNotes.length) out.taxon_notes = r.narrowingNotes;
  if (Object.keys(r.groups).length) out.groups = r.groups;
  if (r.coverage) out.coverage = r.coverage;
  if (r.tooLarge) out.too_large = true;
  if (!countOnly) {
    out.shown = r.shown;
    out.capped = r.capped;
    out.species = r.species.map((s) => shapeSpecies(s, v, hasGeoFilter));
  }
  return out;
}

// Attach the standing dashboard link, primary-source guidance, Red List version,
// and verify nudge — server-side so they can't be skipped by the agent.
const reply = (input: BrowseInput, body: Record<string, unknown>) =>
  asText({
    ...body,
    red_list_version: RED_LIST_VERSION,
    dashboard_url: browseInputToDashboardUrl(getOrigin(), input),
    sources: SOURCES_NOTE,
    verify_note: VERIFY_NOTE,
  });

// Shared optional-filter schema for browse_taxon.
const FILTERS = {
  categories: z.array(z.string()).optional().describe("IUCN status codes or names: CR, EN, VU, NT, LC, DD, NE, EX, EW — or 'threatened' (=CR,EN,VU). NE = not yet evaluated."),
  threats: z.array(z.string()).optional().describe("IUCN threat codes (prefix match, e.g. '11' = climate change) or aliases like climate-change, pollution, overfishing."),
  countries: z.array(z.string()).optional().describe("ISO alpha-2 codes or country names."),
  region: z.string().optional().describe("An IUCN region (expands to its countries), e.g. 'Sub-Saharan Africa'."),
  assessors: z.array(z.string()).optional().describe("Latest-assessment assessor name (substring match)."),
  reviewers: z.array(z.string()).optional().describe("Latest-assessment reviewer name (substring match)."),
  systems: z.array(z.string()).optional(),
  trends: z.array(z.string()).optional().describe("Population trend: Increasing, Decreasing, Stable, Unknown."),
  hasMap: z.enum(["yes", "no"]).optional(),
  outdated: z.enum(["yes", "no"]).optional().describe("Assessment older than 10 years."),
  minObs: z.number().optional(), maxObs: z.number().optional(),
  minAssessmentYear: z.number().optional(), maxAssessmentYear: z.number().optional(),
  minDescribedYear: z.number().optional(), maxDescribedYear: z.number().optional(),
};

// Output-shaping controls, shared by browse_taxon (and verbosity by find_species).
const VERBOSITY = z.enum(["summary", "compact", "full"]).optional()
  .describe("Per-species detail. summary = name/common/category/trend/outdated(+endemism) only; compact (DEFAULT) adds assessment date, GBIF count, country_count, threats, and primary_sources; full also restores the per-species countries array + systems. Use summary/compact to keep payloads small.");
const GROUP_BY = z.array(z.enum(["category", "threat", "trend", "system", "endemism", "country"])).optional()
  .describe("Server-side aggregation over the FULL matched set (token-cheap, more reliable than eyeballing rows). Returns `groups` with counts per bucket. 'threat' groups by top-level IUCN threat; 'endemism' needs a country/region filter.");
const COUNT_ONLY = z.boolean().optional()
  .describe("Omit the species list and return only total/breakdown/stats/groups — for 'how many' questions.");

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "browse_taxon",
      {
        title: "Browse a taxon",
        description:
          "List/aggregate IUCN Red List species under a taxon, with GBIF + Catalogue of Life data. `taxa` works at ANY rank: a curated group (birds, corals), a sub-group (sharks-rays, flatworms), or a scientific class/order/family name (felidae, odonata) — and accepts an ARRAY of taxa to get one summary block per taxon in a single call. Returns total + by-category breakdown + an `outdated`/`stats` block (use it for percentage questions like '% of mammals outdated') + a `coverage` block (how many in the group are Not Evaluated globally) + a capped species list. Use `groupBy` for server-side counts, `countOnly` to drop the list, and `verbosity` to control payload size. Combine optional filters (AND across filters; OR within a list).",
        inputSchema: {
          taxa: z.union([z.string(), z.array(z.string())]).describe("A taxonomic group, sub-group, or scientific name (any rank). Pass an array of these to get a per-taxon summary block for each in one call."),
          ...FILTERS,
          verbosity: VERBOSITY,
          groupBy: GROUP_BY,
          countOnly: COUNT_ONLY,
        },
      },
      async (args) => {
        const { taxa, region, verbosity, groupBy, countOnly, ...rest } =
          args as { taxa: string | string[]; region?: string; verbosity?: Verbosity; groupBy?: string[]; countOnly?: boolean } & Record<string, unknown>;
        const v: Verbosity = verbosity ?? "compact";
        const regionArr = region ? [region] : [];
        const groupByArr = groupBy ?? [];
        const baseRest = rest as BrowseInput;
        const taxaList = (Array.isArray(taxa) ? taxa : [taxa]).map((t) => t.trim()).filter(Boolean);

        // Multi-taxon: run each taxon independently and return a per-taxon summary
        // block — saves the round trips of building a cross-group picture by hand.
        if (taxaList.length > 1) {
          const per_taxon = await Promise.all(taxaList.map(async (t) => {
            const input: BrowseInput = { ...baseRest, taxa: [t], region: regionArr, groupBy: groupByArr };
            const body = shapeResult(input, await runBrowseQuery(input), v, !!countOnly);
            return { taxon: t, label: taxonLabel(t), ...body, dashboard_url: browseInputToDashboardUrl(getOrigin(), input) };
          }));
          const unionInput: BrowseInput = { ...baseRest, taxa: taxaList, region: regionArr };
          return reply(unionInput, { multi_taxon: true, per_taxon });
        }

        const input: BrowseInput = { ...baseRest, taxa: taxaList, region: regionArr, groupBy: groupByArr };
        return reply(input, shapeResult(input, await runBrowseQuery(input), v, !!countOnly));
      },
    );

    server.registerTool(
      "find_species",
      {
        title: "Look up a species by name",
        description: "Find a species by scientific or common name, including synonyms / old names (they resolve to the accepted species). Returns the matching species with IUCN category, GBIF/CoL info, citable `primary_sources` links, and (if matched via an old name) the matched synonym.",
        inputSchema: { name: z.string().describe("Scientific or common name, e.g. 'tiger' or 'Felis jubata'."), verbosity: VERBOSITY },
      },
      async (args) => {
        const { name, verbosity } = args as { name: string; verbosity?: Verbosity };
        const input: BrowseInput = { search: name };
        return reply(input, shapeResult(input, await runBrowseQuery(input), verbosity ?? "compact", false));
      },
    );

    server.registerTool(
      "get_vocabulary",
      {
        title: "Get the valid filter vocabulary",
        description: "Returns the valid values for browse_taxon: featured taxon groups, IUCN threat categories, status categories, IUCN regions, systems, population trends, plus the output-shaping options (verbosity, groupBy, countOnly). Call this first if unsure what values to pass.",
        inputSchema: {},
      },
      async () =>
        asText({
          taxa: FEATURED_TAXA.map((id) => ({ id, label: taxonLabel(id) })),
          note: "taxa also accepts any sub-group or scientific class/order/family name, or an ARRAY of taxa for per-taxon summary blocks.",
          threats: THREAT_CATEGORIES.map((t) => ({ code: t.code, label: t.label })),
          categories: ALL_CATEGORIES.map((c) => ({ code: c, label: categoryLabel(c) })),
          regions: IUCN_REGION_ORDER,
          systems: SYSTEMS,
          trends: POPULATION_TRENDS,
          output_options: {
            verbosity: ["summary", "compact (default)", "full"],
            groupBy: ["category", "threat", "trend", "system", "endemism", "country"],
            countOnly: "boolean — return only aggregates, no species list",
          },
          red_list_version: RED_LIST_VERSION,
        }),
    );
  },
  {},
  { basePath: "/api" },
);

// Run the MCP handler inside the origin context so tool callbacks can build
// absolute dashboard links from this request's host.
const withOrigin = (h: (req: Request) => Promise<Response> | Response) => (req: Request) => {
  let origin = "";
  try { origin = new URL(req.url).origin; } catch { /* leave empty → relative link */ }
  return originStore.run(origin, () => h(req));
};

const GET = withOrigin(handler);
const POST = withOrigin(handler);
const DELETE = withOrigin(handler);

export { GET, POST, DELETE };
