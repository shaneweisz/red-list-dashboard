import { NextRequest } from "next/server";
import { GoogleGenAI, Type, FunctionCallingConfigMode, type Tool } from "@google/genai";
import { searchSpecies } from "@/lib/data/species-store";
import { parseAssessors } from "@/lib/parseAssessors";
import * as fs from "fs";
import * as path from "path";

// ─── Assessor name index (built lazily, cached in-process) ──────────

const DATA_DIR = path.join(process.cwd(), "data");
const HISTORY_DIR = path.join(DATA_DIR, "redlist", "history");
const HISTORY_GROUPS = [
  "amphibia", "aves", "fishes", "mammalia", "reptilia",
  "insecta", "arachnida", "gastropoda", "bivalvia", "malacostraca", "anthozoa",
  "plantae",
  "ascomycota", "basidiomycota",
];

let assessorNamesCache: string[] | null = null;

function getAllAssessorNames(): string[] {
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

// ─── Tool implementations ───────────────────────────────────────────

function toolSearchSpecies(query: string, limit: number): string {
  const results = searchSpecies(query, Math.min(limit, 20));
  if (results.length === 0) return "No species found matching that query.";
  return results
    .map(
      (r) =>
        `${r.scientific_name}${r.common_name ? ` (${r.common_name})` : ""} — ${r.category}, taxon: ${r.taxon_id}` +
        (r.countries.length > 0 ? `, countries: ${r.countries.slice(0, 10).join(",")}` : "")
    )
    .join("\n");
}

function toolSearchAssessors(query: string): string {
  const q = query.toLowerCase();
  const all = getAllAssessorNames();
  const matches = all.filter((n) => n.toLowerCase().includes(q));
  if (matches.length === 0) return "No assessors found matching that query.";
  if (matches.length > 30) {
    return `Found ${matches.length} matches. Showing first 30:\n${matches.slice(0, 30).join("\n")}`;
  }
  return matches.join("\n");
}

function toolGetTaxonomySubgroups(parentId: string): string {
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

// ─── Gemini tool declarations ───────────────────────────────────────

const tools: Tool[] = [
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

const SYSTEM_PROMPT = `You are an assistant for the IUCN Red List Assessments Dashboard. Your job is to translate a user's natural language query into URL query parameters that filter the dashboard.

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
3. "frogs" = amphibia. "moths"/"butterflies" = invertebrates. "trees"/"flowers" = plantae.
4. For "random" queries, apply the relevant filters — the dashboard shows matching species.
5. For complex observation queries like "at least 100 new GBIF observations comprising over 50% of total": use obsRanges AND sort by pctNewGbif desc.
6. Be generous interpreting intent — handle typos, informal language, abbreviations.
7. Keep your reasoning concise — a few sentences per step, not paragraphs.`;

// ─── SSE streaming handler ──────────────────────────────────────────

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "GEMINI_API_KEY not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let body: { query: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { query } = body;
  if (!query || typeof query !== "string" || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: "Missing 'query' field" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      }

      try {
        const ai = new GoogleGenAI({ apiKey });

        // Start with the user query as contents
        const contents: Array<{
          role: string;
          parts: Array<
            | { text: string }
            | { functionCall: { name: string; args: Record<string, unknown> } }
            | { functionResponse: { name: string; response: { result: string } } }
          >;
        }> = [{ role: "user", parts: [{ text: query.trim() }] }];

        // Agentic loop — up to 10 iterations
        for (let i = 0; i < 10; i++) {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents,
            config: {
              systemInstruction: SYSTEM_PROMPT,
              temperature: 0.2,
              maxOutputTokens: 2048,
              tools,
              toolConfig: {
                functionCallingConfig: {
                  mode: FunctionCallingConfigMode.AUTO,
                },
              },
              thinkingConfig: {
                thinkingBudget: 2048,
              },
            },
          });

          const candidate = response.candidates?.[0];
          if (!candidate?.content?.parts) break;

          const parts = candidate.content.parts;

          // Stream any thinking or text parts as reasoning
          for (const part of parts) {
            if ("thought" in part && part.thought && "text" in part && part.text) {
              send("thinking", { text: part.text });
            } else if ("text" in part && part.text && !("thought" in part)) {
              send("reasoning", { text: part.text });
            }
          }

          // Check for function calls
          const functionCalls = parts.filter(
            (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
              "functionCall" in p && p.functionCall !== undefined
          );

          if (functionCalls.length === 0) {
            // No more function calls and no generate_url — model is done
            break;
          }

          // Add model's response to conversation
          contents.push({ role: "model", parts: parts as typeof contents[0]["parts"] });

          // Execute function calls and collect responses
          const functionResponseParts: Array<{
            functionResponse: { name: string; response: { result: string } };
          }> = [];

          for (const fc of functionCalls) {
            const { name, args } = fc.functionCall;

            send("tool_call", { name, args });

            let result: string;
            switch (name) {
              case "search_species":
                result = toolSearchSpecies(
                  (args.query as string) || "",
                  (args.limit as number) || 5
                );
                break;
              case "search_assessors":
                result = toolSearchAssessors((args.query as string) || "");
                break;
              case "get_taxonomy_subgroups":
                result = toolGetTaxonomySubgroups(
                  (args.parent_id as string) || ""
                );
                break;
              case "generate_url": {
                const qs = (args.query_string as string) || "";
                const explanation = (args.explanation as string) || "";
                send("result", { queryString: qs, explanation });
                controller.close();
                return;
              }
              default:
                result = `Unknown tool: ${name}`;
            }

            send("tool_result", { name, result });
            functionResponseParts.push({
              functionResponse: { name, response: { result } },
            });
          }

          contents.push({ role: "user", parts: functionResponseParts });
        }

        // If we got here without generate_url, try to extract from any text
        send("error", { message: "AI did not produce a final URL. Please try rephrasing." });
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        console.error("AI search error:", message);
        send("error", { message: `AI request failed: ${message}` });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
