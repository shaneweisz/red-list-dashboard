import { NextRequest } from "next/server";
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import {
  SYSTEM_PROMPT,
  geminiTools,
  dispatchToolCall,
} from "@/lib/ai-search";

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

        const contents: Array<{
          role: string;
          parts: Array<
            | { text: string }
            | { functionCall: { name: string; args: Record<string, unknown> } }
            | { functionResponse: { name: string; response: { result: string } } }
          >;
        }> = [{ role: "user", parts: [{ text: query.trim() }] }];

        for (let i = 0; i < 10; i++) {
          const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
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
                thinkingBudget: 2048,
              },
            },
          });

          const candidate = response.candidates?.[0];
          if (!candidate?.content?.parts) break;

          const parts = candidate.content.parts;

          for (const part of parts) {
            if ("thought" in part && part.thought && "text" in part && part.text) {
              send("thinking", { text: part.text });
            } else if ("text" in part && part.text && !("thought" in part)) {
              send("reasoning", { text: part.text });
            }
          }

          const functionCalls = parts.filter(
            (p): p is { functionCall: { name: string; args: Record<string, unknown> } } =>
              "functionCall" in p && p.functionCall !== undefined
          );

          if (functionCalls.length === 0) break;

          contents.push({ role: "model", parts: parts as typeof contents[0]["parts"] });

          const functionResponseParts: Array<{
            functionResponse: { name: string; response: { result: string } };
          }> = [];

          for (const fc of functionCalls) {
            const { name, args } = fc.functionCall;

            send("tool_call", { name, args });

            if (name === "generate_url") {
              const qs = (args.query_string as string) || "";
              const explanation = (args.explanation as string) || "";
              send("result", { queryString: qs, explanation });
              controller.close();
              return;
            }

            const result = dispatchToolCall(name, args);
            send("tool_result", { name, result });
            functionResponseParts.push({
              functionResponse: { name, response: { result } },
            });
          }

          contents.push({ role: "user", parts: functionResponseParts });
        }

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
