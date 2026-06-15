/**
 * Remote MCP server for the Red List dashboard — structured tool access to the same
 * data the /browse endpoint exposes, for agents (Claude Code, claude.ai connectors,
 * ChatGPT). MCP tool calls bypass the two walls that break direct fetching from an
 * agent sandbox: they're not subject to web_fetch's verbatim-URL allowlist, and they
 * originate off the sandbox (no egress allowlist). Tools call runBrowseQuery directly
 * — the same logic /browse uses, so results are identical.
 *
 * Served at /api/mcp (streamable HTTP) via the [transport] segment. Gated by a bearer
 * token (env MCP_TOKEN); clients send `Authorization: Bearer <token>`.
 */
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import { runBrowseQuery, type BrowseInput } from "@/lib/browse-query";
import {
  FEATURED_TAXA, THREAT_CATEGORIES, ALL_CATEGORIES,
  taxonLabel, categoryLabel, SYSTEMS, POPULATION_TRENDS,
} from "@/lib/filter-vocab";
import { IUCN_REGION_ORDER } from "@/lib/regions";

export const maxDuration = 60;

const asText = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] });

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

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      "browse_taxon",
      {
        title: "Browse a taxon",
        description:
          "List/aggregate IUCN Red List species under a taxon, with GBIF + Catalogue of Life data. `taxa` works at ANY rank: a curated group (birds, corals), a sub-group (sharks-rays, flatworms), or a scientific class/order/family name (felidae, odonata). Returns total + by-category breakdown + an `outdated`/`stats` block (use it for percentage questions like '% of mammals outdated') + a capped species list. Combine optional filters (AND across filters; OR within a list).",
        inputSchema: { taxa: z.string().describe("A taxonomic group, sub-group, or scientific name (any rank)."), ...FILTERS },
      },
      async (args) => {
        const { taxa, region, ...rest } = args as { taxa: string; region?: string } & Record<string, unknown>;
        const input: BrowseInput = { ...(rest as BrowseInput), taxa: [taxa], region: region ? [region] : [] };
        return asText(await runBrowseQuery(input));
      },
    );

    server.registerTool(
      "find_species",
      {
        title: "Look up a species by name",
        description: "Find a species by scientific or common name, including synonyms / old names (they resolve to the accepted species). Returns the matching species with IUCN category, GBIF/CoL info, and (if matched via an old name) the matched synonym.",
        inputSchema: { name: z.string().describe("Scientific or common name, e.g. 'tiger' or 'Felis jubata'.") },
      },
      async (args) => {
        const { name } = args as { name: string };
        return asText(await runBrowseQuery({ search: name }));
      },
    );

    server.registerTool(
      "get_vocabulary",
      {
        title: "Get the valid filter vocabulary",
        description: "Returns the valid values for browse_taxon: featured taxon groups, IUCN threat categories, status categories, IUCN regions, systems, and population trends. Call this first if unsure what values to pass.",
        inputSchema: {},
      },
      async () =>
        asText({
          taxa: FEATURED_TAXA.map((id) => ({ id, label: taxonLabel(id) })),
          note: "taxa also accepts any sub-group or scientific class/order/family name.",
          threats: THREAT_CATEGORIES.map((t) => ({ code: t.code, label: t.label })),
          categories: ALL_CATEGORIES.map((c) => ({ code: c, label: categoryLabel(c) })),
          regions: IUCN_REGION_ORDER,
          systems: SYSTEMS,
          trends: POPULATION_TRENDS,
        }),
    );
  },
  {},
  { basePath: "/api" },
);

// Bearer-token gate (env MCP_TOKEN). Clients send `Authorization: Bearer <token>`.
const verifyToken = async (_req: Request, bearer?: string): Promise<AuthInfo | undefined> => {
  const expected = process.env.MCP_TOKEN;
  if (!expected || !bearer || bearer !== expected) return undefined;
  return { token: bearer, scopes: [], clientId: "redlist-dashboard", extra: {} };
};

const authed = withMcpAuth(handler, verifyToken, { required: true });

export { authed as GET, authed as POST, authed as DELETE };
