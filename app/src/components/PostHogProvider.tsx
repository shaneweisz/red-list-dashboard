"use client";

import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";

if (
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_POSTHOG_KEY
) {
  posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY, {
    // First-party reverse proxy (see next.config.ts rewrites) so ad/tracking
    // blockers can't drop events. ui_host keeps "View in PostHog" links pointing
    // at the real EU dashboard.
    api_host: "/ingest",
    ui_host: "https://eu.posthog.com",
    // In-memory persistence: the distinct_id lives only in JS for the page
    // session — no cookie or localStorage, so no consent banner is needed. We
    // avoid cookieless server-hash mode because it derives identity from the
    // client IP, which our server-side /ingest proxy hides from PostHog.
    persistence: "memory",
    disable_session_recording: true,
  });
}

export function PostHogProvider({ children }: { children: React.ReactNode }) {
  return <PHProvider client={posthog}>{children}</PHProvider>;
}
