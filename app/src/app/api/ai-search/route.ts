import { NextRequest } from "next/server";
import { GoogleGenAI, FunctionCallingConfigMode } from "@google/genai";
import {
  SYSTEM_PROMPT,
  geminiTools,
  dispatchToolCall,
  validateQueryString,
} from "@/lib/ai-search";
import { getLangfuse } from "@/lib/langfuse";

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
      const delay = Math.pow(2, attempt + 1) * 1000;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const DEFAULT_MODEL = "gemini-3.1-flash-lite-preview";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;
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

      const langfuse = getLangfuse();
      const trace = langfuse?.trace({
        name: "ai-search",
        input: { query: query.trim() },
        tags: ["ai-search"],
      });

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
          const genStart = Date.now();
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
                  thinkingBudget: 2048,
                },
              },
            })
          );

          const candidate = response.candidates?.[0];
          if (!candidate?.content?.parts) break;

          const parts = candidate.content.parts;

          // Log the LLM generation to Langfuse
          const usage = response.usageMetadata;
          trace?.generation({
            name: `gemini-turn-${i}`,
            model,
            input: i === 0 ? query.trim() : contents.slice(-1),
            output: parts,
            startTime: new Date(genStart),
            endTime: new Date(),
            usage: usage ? {
              input: usage.promptTokenCount ?? 0,
              output: usage.candidatesTokenCount ?? 0,
              total: usage.totalTokenCount ?? 0,
            } : undefined,
          });

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
              const rawQs = (args.query_string as string) || "";
              const explanation = (args.explanation as string) || "";
              const { fixed, warnings } = validateQueryString(rawQs);

              if (warnings.length > 0) {
                // Feed errors back to the model so it can fix them
                send("validation", { warnings });
                contents.push({ role: "model", parts: parts as typeof contents[0]["parts"] });
                contents.push({
                  role: "user",
                  parts: [{
                    functionResponse: {
                      name: "generate_url",
                      response: {
                        result: `VALIDATION ERROR: ${warnings.join("; ")}. Please call generate_url again with corrected values.`,
                      },
                    },
                  }],
                });
                break; // continue outer loop so model can retry
              }

              trace?.update({ output: { queryString: fixed, explanation } });
              send("result", { queryString: fixed, explanation });
              await langfuse?.flushAsync();
              controller.close();
              return;
            }

            const toolSpan = trace?.span({ name: `tool:${name}`, input: args });
            const result = dispatchToolCall(name, args);
            toolSpan?.end({ output: { result: result.slice(0, 500) } });
            send("tool_result", { name, result });
            functionResponseParts.push({
              functionResponse: { name, response: { result } },
            });
          }

          contents.push({ role: "user", parts: functionResponseParts });
        }

        trace?.update({ output: { error: "No final URL produced" } });
        send("error", { message: "AI did not produce a final URL. Please try rephrasing." });
        await langfuse?.flushAsync();
        controller.close();
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unknown error";
        console.error("AI search error:", message);
        trace?.update({ output: { error: message } });
        await langfuse?.flushAsync();
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
