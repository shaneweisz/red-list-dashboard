"use client";

import { useState } from "react";
import { usePostHog } from "posthog-js/react";

export function CookieConsentBanner() {
  const posthog = usePostHog();
  const [consentGiven, setConsentGiven] = useState(
    posthog.get_explicit_consent_status()
  );

  function handleAccept() {
    posthog.opt_in_capturing();
    setConsentGiven("granted");
  }

  function handleDecline() {
    posthog.opt_out_capturing();
    setConsentGiven("denied");
  }

  function reset() {
    posthog.clear_opt_in_out_capturing();
    setConsentGiven("pending");
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
        <p className="text-xs" style={{ color: muted }}>
          We use tracking cookies to understand how you use the product and help
          us improve it. Please accept cookies to help us improve.{" "}
          <a href="/privacy" className="underline hover:opacity-70">
            Privacy policy
          </a>
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={handleDecline}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{ borderColor: border, color: muted }}
          >
            Decline
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
            Accept cookies
          </button>
        </div>
      </div>
    </div>
  );
}

/** Re-open the consent banner by clearing the stored choice. */
export function CookieConsentReset() {
  const posthog = usePostHog();

  return (
    <button
      type="button"
      onClick={() => {
        posthog.clear_opt_in_out_capturing();
        window.location.reload();
      }}
      className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
    >
      Cookie settings
    </button>
  );
}
