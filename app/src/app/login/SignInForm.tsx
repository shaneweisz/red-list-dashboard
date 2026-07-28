"use client";

import { useSyncExternalStore } from "react";
import { signInWithGitHub } from "@/lib/auth/actions";

// window.location.origin never changes for the life of the page, so there is
// nothing to subscribe to — this is just the React-sanctioned way to read a
// browser-only value without a hydration mismatch. It renders as "" on the
// server and during hydration, then as the real origin.
const NEVER_CHANGES = () => () => {};
const readOrigin = () => window.location.origin;
const noOriginOnServer = () => "";

/**
 * Sends the browser's own origin along with the sign-in request.
 *
 * The server can't derive it reliably: red.cst.cam.ac.uk and en.ki are proxied
 * to Vercel through a Caddy instance that rewrites the Host header, so the
 * request arrives claiming to be red-list-dashboard.vercel.app and the OAuth
 * callback used to be sent there — to a domain without the PKCE cookie, which
 * failed the exchange (#416). Only the browser knows the true origin.
 *
 * Filled in after hydration (window doesn't exist during SSR). If JavaScript
 * never runs, the field stays empty and the server falls back to the request
 * headers, which is what every Vercel-served domain used before this.
 */
export function SignInForm() {
  const origin = useSyncExternalStore(NEVER_CHANGES, readOrigin, noOriginOnServer);

  return (
    <form action={signInWithGitHub}>
      <input type="hidden" name="origin" value={origin} />
      <button
        type="submit"
        className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 font-medium hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23a11.28 11.28 0 013-.405c1.02 0 2.04.135 3 .405 2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
        </svg>
        Sign in with GitHub
      </button>
    </form>
  );
}
