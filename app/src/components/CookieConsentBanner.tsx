"use client";

import { useEffect, useState } from "react";
import posthog from "posthog-js";

const STORAGE_KEY = "cookie_consent";

export function CookieConsentBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const consent = localStorage.getItem(STORAGE_KEY);
    if (consent === "granted") {
      posthog.opt_in_capturing();
      posthog.startSessionRecording();
    } else if (consent === "denied") {
      posthog.opt_out_capturing();
    } else {
      setVisible(true);
    }
  }, []);

  function accept() {
    localStorage.setItem(STORAGE_KEY, "granted");
    posthog.opt_in_capturing();
    posthog.startSessionRecording();
    setVisible(false);
  }

  function decline() {
    localStorage.setItem(STORAGE_KEY, "denied");
    posthog.opt_out_capturing();
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-50 border-t px-3 py-1 shadow-lg"
      style={{
        backgroundColor: "var(--background)",
        borderColor: "color-mix(in srgb, var(--foreground) 15%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
        <p
          className="text-xs"
          style={{ color: "color-mix(in srgb, var(--foreground) 60%, transparent)" }}
        >
          Allow cookies for analytics and session recordings to help improve
          your experience using the dashboard?
        </p>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={decline}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{
              borderColor: "color-mix(in srgb, var(--foreground) 20%, transparent)",
              color: "color-mix(in srgb, var(--foreground) 70%, transparent)",
            }}
          >
            Decline
          </button>
          <button
            onClick={accept}
            className="cursor-pointer rounded-md border px-3 py-1 text-xs transition-opacity hover:opacity-80"
            style={{
              borderColor: "color-mix(in srgb, var(--foreground) 25%, transparent)",
              backgroundColor: "color-mix(in srgb, var(--foreground) 10%, transparent)",
              color: "var(--foreground)",
            }}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
