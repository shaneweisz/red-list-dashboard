import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadEnvFiles } from "./utils";
loadEnvFiles();

const url = process.argv[2];
const bypass = "D3YN8EGNAah2FbzEim8xvfIYrUA6KQ0c";
const mcp = process.env.MCP_TOKEN!;
const withAuth = process.argv[3] !== "noauth";

(async () => {
  const headers: Record<string, string> = { "x-vercel-protection-bypass": bypass };
  if (withAuth) headers["Authorization"] = "Bearer " + mcp;
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
  const client = new Client({ name: "redlist-test", version: "1.0.0" }, { capabilities: {} });
  try {
    await client.connect(transport);
  } catch (e) {
    console.log("CONNECT FAILED (expected for noauth):", String(e).slice(0, 120));
    process.exit(0);
  }
  const tools = await client.listTools();
  console.log("tools:", tools.tools.map((t) => t.name).join(", "));
  const r1 = await client.callTool({ name: "browse_taxon", arguments: { taxa: "corals", categories: ["CR", "EN"] } });
  const d1 = JSON.parse((r1.content as { text: string }[])[0].text);
  console.log("browse_taxon corals CR/EN → total:", d1.total, "| stats:", JSON.stringify(d1.stats));
  const r2 = await client.callTool({ name: "find_species", arguments: { name: "Felis jubata" } });
  const d2 = JSON.parse((r2.content as { text: string }[])[0].text);
  console.log("find_species 'Felis jubata' →", d2.species?.[0]?.scientific_name, "| matched_synonym:", d2.species?.[0]?.matched_synonym);
  await client.close();
  process.exit(0);
})().catch((e) => { console.error("ERR:", String(e).slice(0, 200)); process.exit(1); });
