/**
 * AI Search core logic — tool implementations and agentic loop.
 *
 * Extracted from the route handler so it can be unit-tested (tools)
 * and integration-tested (full LLM round-trip).
 */

import { GoogleGenAI, Type, FunctionCallingConfigMode, type Tool } from "@google/genai";
import { searchSpecies, getSpecies } from "@/lib/data/species-store";
import { getCsvGroupsForNode } from "@/lib/taxonomy-utils";
import { parseAssessors } from "@/lib/parseAssessors";
import * as fs from "fs";
import * as path from "path";

// ─── Data paths ─────────────────────────────────────────────────────

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_DIR = path.join(DATA_DIR, "redlist", "history");
const HISTORY_GROUPS = [
  "amphibia", "aves", "fishes", "mammalia", "reptilia",
  "insecta", "arachnida", "mollusca", "crustacea", "corals",
  "horseshoe_crabs", "other_invertebrates", "velvet_worms",
  "flowering_plants", "gymnosperms", "ferns_and_allies", "mosses",
  "brown_algae", "green_algae", "red_algae",
  "mushrooms",
];

// ─── Assessor name index (built lazily, cached in-process) ──────────

let assessorNamesCache: string[] | null = null;

/** @internal Reset cache for tests */
export function _resetAssessorCache(): void {
  assessorNamesCache = null;
}

export function getAllAssessorNames(): string[] {
  if (assessorNamesCache) return assessorNamesCache;
  const nameSet = new Set<string>();
  for (const group of HISTORY_GROUPS) {
    const jsonPath = path.join(HISTORY_DIR, `${group}.json`);
    if (!fs.existsSync(jsonPath)) continue;
    const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8")) as Record<
      string,
      { assessors: string | null; reviewers: string | null }[]
    >;
    for (const assessments of Object.values(data)) {
      for (const a of assessments) {
        for (const name of parseAssessors(a.assessors)) {
          if (name.length >= 3) nameSet.add(name);
        }
        for (const name of parseAssessors(a.reviewers)) {
          if (name.length >= 3) nameSet.add(name);
        }
      }
    }
  }
  assessorNamesCache = [...nameSet].sort();
  return assessorNamesCache;
}

// ─── Tool implementations (exported for testing) ────────────────────

export function toolSearchSpecies(query: string, limit: number): string {
  const results = searchSpecies(query, Math.min(limit, 20));
  if (results.length === 0) return "No species found matching that query.";
  return results
    .map(
      (r) =>
        `[id:${r.id}] ${r.scientific_name}${r.common_name ? ` (${r.common_name})` : ""} — ${r.category}, taxon: ${r.taxon_id}` +
        (r.countries.length > 0 ? `, countries: ${r.countries.slice(0, 10).join(",")}` : "")
    )
    .join("\n");
}

export function toolSearchAssessors(query: string): string {
  const q = query.toLowerCase();
  const all = getAllAssessorNames();
  const matches = all.filter((n) => n.toLowerCase().includes(q));
  if (matches.length === 0) return "No assessors found matching that query.";
  if (matches.length > 30) {
    return `Found ${matches.length} matches. Showing first 30:\n${matches.slice(0, 30).join("\n")}`;
  }
  return matches.join("\n");
}

export function toolGetTaxonomySubgroups(parentId: string): string {
  const summariesPath = path.join(DATA_DIR, "node-children-summaries.json");
  if (!fs.existsSync(summariesPath)) return "Subgroups data not available.";
  const data = JSON.parse(fs.readFileSync(summariesPath, "utf-8")) as Record<
    string,
    { id: string; name: string; totalAssessed: number; byCategory?: Record<string, number> }[]
  >;
  const children = data[parentId];
  if (!children || children.length === 0) return `No subgroups found for "${parentId}".`;
  return children
    .map((c) => `${c.id}: ${c.name} (${c.totalAssessed} assessed)`)
    .join("\n");
}

export function toolPickRandomSpecies(
  taxaId: string,
  countries?: string[],
  categories?: string[],
): string {
  const groups = getCsvGroupsForNode(taxaId);
  let species = getSpecies(groups, false);

  if (countries && countries.length > 0) {
    const countrySet = new Set(countries.map((c) => c.toUpperCase()));
    species = species.filter((s) =>
      s.countries.some((c) => countrySet.has(c))
    );
  }

  if (categories && categories.length > 0) {
    const catSet = new Set(categories);
    species = species.filter((s) => catSet.has(s.category));
  }

  if (species.length === 0) return "No species match those filters.";

  const pick = species[Math.floor(Math.random() * species.length)];
  return (
    `Randomly selected 1 of ${species.length} matching species:\n` +
    `[id:${pick.id}] ${pick.scientific_name}${pick.common_name ? ` (${pick.common_name})` : ""} — ${pick.category}, taxon: ${pick.taxon_id}` +
    (pick.countries.length > 0 ? `, countries: ${pick.countries.slice(0, 10).join(",")}` : "")
  );
}

/** Dispatch a tool call by name, return the string result */
export function dispatchToolCall(
  name: string,
  args: Record<string, unknown>
): string {
  switch (name) {
    case "search_species":
      return toolSearchSpecies(
        (args.query as string) || "",
        (args.limit as number) || 5
      );
    case "search_assessors":
      return toolSearchAssessors((args.query as string) || "");
    case "get_taxonomy_subgroups":
      return toolGetTaxonomySubgroups((args.parent_id as string) || "");
    case "pick_random_species":
      return toolPickRandomSpecies(
        (args.taxa_id as string) || "all",
        args.countries ? (args.countries as string[]) : undefined,
        args.categories ? (args.categories as string[]) : undefined,
      );
    default:
      return `Unknown tool: ${name}`;
  }
}

// ─── Gemini tool declarations ───────────────────────────────────────

export const geminiTools: Tool[] = [
  {
    functionDeclarations: [
      {
        name: "search_species",
        description:
          "Search for species by scientific name or common name. Use this to verify species exist, check their taxon group and IUCN category, and find correct spellings.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "The species name to search for (scientific or common name)",
            },
            limit: {
              type: Type.NUMBER,
              description: "Max results to return (default 5, max 20)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "search_assessors",
        description:
          "Search for IUCN Red List assessor or reviewer names. Use this to find the correct spelling/format of a person's name (e.g. 'Bachman' → 'Bachman, S.P.'). Names are in 'Lastname, Initials' format.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query: {
              type: Type.STRING,
              description: "Partial name to search for (case-insensitive)",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "get_taxonomy_subgroups",
        description:
          "Get the available subgroups (children) for a taxonomy node. For example, 'mammalia' has children like 'mammalia/primates', 'mammalia/carnivora', etc. Use this when the user mentions a specific order or family to find the correct subgroup ID.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            parent_id: {
              type: Type.STRING,
              description:
                "The taxonomy node ID to look up children for (e.g. 'all', 'mammalia', 'aves', 'invertebrates', 'mammalia/primates')",
            },
          },
          required: ["parent_id"],
        },
      },
      {
        name: "pick_random_species",
        description:
          "Pick one random species matching the given filters. Use this when the user asks for 'a random species', 'pick one', 'choose one', 'surprise me', etc. Returns exactly one species with its ID, name, category, and countries. After calling this, use the returned species ID in generate_url with the species=ID parameter to navigate directly to that species.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            taxa_id: {
              type: Type.STRING,
              description: "Taxonomy node ID to filter by (e.g. 'aves', 'mammalia', 'amphibia', 'all')",
            },
            countries: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Optional array of ISO country codes to filter by (e.g. ['ZA', 'BR'])",
            },
            categories: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "Optional array of IUCN categories to filter by (e.g. ['CR', 'EN', 'VU'])",
            },
          },
          required: ["taxa_id"],
        },
      },
      {
        name: "generate_url",
        description:
          "Generate the final dashboard URL query string. Call this ONCE when you have all the information needed. This is the final step — after calling this, your task is complete.",
        parameters: {
          type: Type.OBJECT,
          properties: {
            query_string: {
              type: Type.STRING,
              description:
                'The URL query string starting with "?" (e.g. "?taxa=amphibia&categories=CR,EN,VU&countries=BR,CO")',
            },
            explanation: {
              type: Type.STRING,
              description: "Brief explanation of the filters applied (1-2 sentences)",
            },
          },
          required: ["query_string", "explanation"],
        },
      },
    ],
  },
];

// ─── System prompt ──────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an assistant for the IUCN Red List Assessments Dashboard. Your job is to translate a user's natural language query into URL query parameters that filter the dashboard.

You have tools to look up real data before building the URL. USE THEM when the query involves:
- Person names (search_assessors) — always verify the exact name format
- Specific species (search_species) — verify they exist and check their taxon/category
- Specific taxonomic groups below the top level (get_taxonomy_subgroups) — find the right subgroup ID

THINK OUT LOUD about your reasoning before and after each tool call. Explain what you're doing and why.

The dashboard has two views:
- "reassessments" (default) — species that have been reassessed
- "new-assessments" — newly assessed species (set via view=new-assessments)

Available URL parameters and their valid values:

**view**: "reassessments" (default, omit) or "new-assessments"
**taxa**: Comma-separated. Valid: all, mammalia, aves, reptilia, amphibia, fishes, invertebrates, plantae, fungi
  - mammalia = Mammals, aves = Birds, reptilia = Reptiles, amphibia = Amphibians (frogs, toads, salamanders, caecilians), fishes = Fishes, invertebrates = Invertebrates (insects, arachnids, molluscs, crustaceans, corals), plantae = Plants, fungi = Fungi & Protists
**subgroups**: Comma-separated taxonomy node IDs for sub-filtering within a taxon (e.g. "mammalia/primates,mammalia/carnivora"). Use get_taxonomy_subgroups to find valid IDs.
**categories**: Comma-separated IUCN categories. Valid: EX, EW, CR, EN, VU, NT, LC, DD, NE
  - "threatened" = CR,EN,VU
  - "near threatened" = NT
**years**: Comma-separated. Valid: "0-1 years", "2-5 years", "6-10 years", "11-20 years", "20+ years"
  - "outdated" = "20+ years" or "11-20 years,20+ years"
  - "recent" = "0-1 years" or "0-1 years,2-5 years"
**countries**: Comma-separated ISO 3166-1 alpha-2 codes.
  - South Africa=ZA, Brazil=BR, Colombia=CO, Australia=AU, Madagascar=MG, India=IN, USA=US, UK=GB, China=CN, Mexico=MX, Peru=PE, Ecuador=EC, Indonesia=ID, Kenya=KE, Tanzania=TZ, Japan=JP, New Zealand=NZ
  - South America: AR,BO,BR,CL,CO,EC,FK,GF,GY,PE,PY,SR,UY,VE
  - Central America: BZ,CR,GT,HN,MX,NI,PA,SV
  - East Africa: BI,DJ,ER,ET,KE,KM,MG,MU,MW,MZ,RE,RW,SC,SO,SS,TZ,UG,YT,ZM,ZW
  - West Africa: BF,BJ,CI,CV,GH,GM,GN,GW,LR,ML,MR,NE,NG,SH,SL,SN,TG
  - Southern Africa: BW,LS,NA,SZ,ZA
  - Europe: AD,AL,AT,AX,BA,BE,BG,BY,CH,CZ,DE,DK,EE,ES,FI,FO,FR,GB,GG,GI,GR,HR,HU,IE,IM,IS,IT,JE,LI,LT,LU,LV,MC,MD,ME,MK,MT,NL,NO,PL,PT,RO,RS,SE,SI,SJ,SK,SM,UA,VA,XK
  - Southeast Asia: BN,ID,KH,LA,MM,MY,PH,SG,TH,TL,VN
  - Caribbean: AG,AI,AW,BB,BL,BQ,BS,CU,CW,DM,DO,GD,GP,HT,JM,KN,KY,LC,MF,MQ,MS,PR,SX,TC,TT,VC,VG,VI
  - Oceania: AS,AU,CK,FJ,FM,GU,KI,MH,MP,NC,NF,NR,NU,NZ,PF,PG,PN,PW,SB,TK,TO,TV,VU,WF,WS
**obsRanges**: Comma-separated. Valid: "0", "1-10", "11-100", "101-1K", "1K-10K", "10K+"
  - "at least 100 new GBIF observations" = "101-1K,1K-10K,10K+"
  - "many observations" = "1K-10K,10K+"
**systems**: Valid: Terrestrial, Freshwater, Marine
**trends**: Valid: Increasing, Stable, Decreasing, Unknown
**movement**: Valid: "Full Migrant", "Altitudinal Migrant", Nomadic, "Not a Migrant", Unknown
**threats**: IUCN codes: 1=Development, 2=Agriculture, 3=Energy & Mining, 4=Transport, 5=Harvesting, 5.1=Hunting, 5.4=Fishing, 7=System modifications, 8=Invasive species, 9=Pollution, 11=Climate change, 11.1=Habitat shifting
**hasMap**: "yes" or "no"
**assessors**: Pipe-separated names in "Lastname, Initials" format. ALWAYS use search_assessors first to verify!
**reviewers**: Pipe-separated reviewer names. ALWAYS use search_assessors first to verify!
**search**: Free-text search to filter by species name
**sort**: year, category, totalGbif, newGbif, pctNewGbif. pctNewGbif = % of total GBIF observations that are new
**dir**: asc or desc (default desc)

RULES:
1. When done, call generate_url with the final query string and a brief explanation.
2. Omit parameters not relevant to the query.
3. "frogs" = amphibia. "moths"/"butterflies" = invertebrates. "trees"/"flowers" = plantae. For specific sub-taxa like "corals", "beetles", "crabs", "primates", "sharks", etc. — set the top-level taxa AND use get_taxonomy_subgroups to find the correct subgroup ID, then include it in the subgroups parameter. For example: "corals" → taxa=invertebrates&subgroups=inv-corals. ALWAYS use get_taxonomy_subgroups when the user mentions a group more specific than the 8 top-level taxa.
4. **RANDOM/SPECIFIC SELECTION**: When the user wants "a random species", "pick one", "choose one", "show me one", "surprise me", etc., you MUST call pick_random_species with the appropriate filters. Then use the returned species ID in generate_url like: "?taxa=aves&countries=ZA&species=12345&tab=gbif". The species=ID parameter navigates directly to that single species. Do NOT just filter — actually select one.
5. For complex observation queries like "at least 100 new GBIF observations comprising over 50% of total": use obsRanges AND sort by pctNewGbif desc.
6. Be generous interpreting intent — handle typos, informal language, abbreviations.
7. Keep your reasoning concise — a few sentences per step, not paragraphs.
8. The search_species tool returns results with [id:NUMBER] prefix — you can use these IDs in the species= URL parameter to link directly to a specific species.`;

// ─── Rate-limit retry helper ────────────────────────────────────────

async function generateWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const is429 =
        err instanceof Error &&
        (err.message.includes("429") || err.message.includes("RESOURCE_EXHAUSTED"));
      if (!is429 || attempt >= maxRetries) throw err;
      const delay = Math.pow(2, attempt + 1) * 1000; // 2s, 4s, 8s
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// ─── Agentic loop (non-streaming, for testing) ─────────────────────

export interface AiSearchResult {
  queryString: string;
  explanation: string;
  toolCalls: Array<{ name: string; args: Record<string, unknown>; result: string }>;
  reasoningSteps: string[];
}

/**
 * Run the full agentic AI search loop and return the final URL.
 * Non-streaming version used for testing and can also serve as a fallback.
 */
export async function runAiSearch(
  userQuery: string,
  apiKey: string,
  options?: { model?: string; maxIterations?: number; thinkingBudget?: number },
): Promise<AiSearchResult> {
  const model = options?.model ?? "gemini-3.1-flash-lite-preview";
  const maxIterations = options?.maxIterations ?? 10;
  const thinkingBudget = options?.thinkingBudget ?? 2048;

  const ai = new GoogleGenAI({ apiKey });

  const contents: Array<{
    role: string;
    parts: Array<
      | { text: string }
      | { functionCall: { name: string; args: Record<string, unknown> } }
      | { functionResponse: { name: string; response: { result: string } } }
    >;
  }> = [{ role: "user", parts: [{ text: userQuery }] }];

  const toolCalls: AiSearchResult["toolCalls"] = [];
  const reasoningSteps: string[] = [];

  for (let i = 0; i < maxIterations; i++) {
    const response = await generateWithRetry(() =>
      ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.2,
          maxOutputTokens: 2048,
          tools: geminiTools,
          toolConfig: {
            functionCallingConfig: {
              mode: FunctionCallingConfigMode.AUTO,
            },
          },
          thinkingConfig: {
            thinkingBudget,
          },
        },
      })
    );

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) break;

    const parts = candidate.content.parts;

    // Collect reasoning
    for (const part of parts) {
      if ("text" in part && part.text) {
        reasoningSteps.push(part.text);
      }
    }

    // Check for function calls
    const functionCallParts = parts.filter(
      (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
        "functionCall" in p && p.functionCall !== undefined
    );

    if (functionCallParts.length === 0) break;

    // Add model response to conversation
    contents.push({ role: "model", parts: parts as typeof contents[0]["parts"] });

    // Execute tool calls
    const functionResponseParts: Array<{
      functionResponse: { name: string; response: { result: string } };
    }> = [];

    for (const fc of functionCallParts) {
      const { name, args } = fc.functionCall;

      if (name === "generate_url") {
        return {
          queryString: (args.query_string as string) || "",
          explanation: (args.explanation as string) || "",
          toolCalls,
          reasoningSteps,
        };
      }

      const result = dispatchToolCall(name, args);
      toolCalls.push({ name, args, result });
      functionResponseParts.push({
        functionResponse: { name, response: { result } },
      });
    }

    contents.push({ role: "user", parts: functionResponseParts });
  }

  throw new Error("AI did not produce a final URL within iteration limit");
}
