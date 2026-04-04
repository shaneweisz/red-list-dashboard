/**
 * Langfuse singleton for LLM observability.
 *
 * Returns `null` when LANGFUSE_SECRET_KEY is not set, so callers can
 * safely no-op without conditional imports.
 */

import { Langfuse } from "langfuse";

let instance: Langfuse | null = null;

export function getLangfuse(): Langfuse | null {
  if (instance) return instance;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  if (!secretKey || !publicKey) return null;
  instance = new Langfuse({
    secretKey,
    publicKey,
    baseUrl: process.env.LANGFUSE_BASE_URL ?? "https://eu.cloud.langfuse.com",
  });
  return instance;
}
