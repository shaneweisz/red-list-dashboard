"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";

type ConsentStatus = "pending" | "granted" | "denied";

export function CookieConsentBanner() {
  const [consentGiven, setConsentGiven] = useState<ConsentStatus | "">("");

  useEffect(() => {
    setConsentGiven(posthog.get_explicit_consent_status());
  }, []);

  function handleAccept() {
    posthog.opt_in_capturing();
    posthog.startSessionRecording();
    setConsentGiven("granted");
  }

  function handleAnalyticsOnly() {
    posthog.opt_in_capturing();
    setConsentGiven("granted");
  }

  function handleDecline() {
    posthog.opt_out_capturing();
    setConsentGiven("denied");
  }

  if (consentGiven !== "pending") return null;

  const muted = "color-mix(in srgb, var(--foreground) 50%, transparent)";
  const border = "color-mix(in srgb, var(--foreground) 20%, transparent)";

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-50 border-t px-4 py-2 shadow-lg"
      style={{
        backgroundColor: "var(--background)",
        borderColor: border,
      }}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>
            We use cookies to improve this dashboard
          </p>
          <p className="text-[11px] mt-0.5" style={{ color: muted }}>
            We use PostHog to collect anonymous usage analytics and session
            recordings. Session recordings capture your clicks, scrolls, and
            navigation — not keystrokes, passwords, or personal data.{" "}
            <a href="/privacy" className="underline hover:opacity-70">
              Privacy policy
            </a>
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleDecline}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: border, color: muted }}
          >
            Decline
          </button>
          <button
            onClick={handleAnalyticsOnly}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: border, color: "var(--foreground)" }}
          >
            Analytics only
          </button>
          <button
            onClick={handleAccept}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{
              borderColor: border,
              backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)",
              color: "var(--foreground)",
            }}
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
