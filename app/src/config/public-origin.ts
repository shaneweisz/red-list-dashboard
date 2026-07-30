// Every public host this app answers on. Keep in step with the brand map in
// ./brand.ts and the Server Actions `allowedOrigins` list in next.config.ts.
//
// This exists because the server cannot always tell which of these it is being
// asked for. red.cst.cam.ac.uk and en.ki are served through a Caddy reverse
// proxy on a Cambridge VM that rewrites the Host header to
// red-list-dashboard.vercel.app before forwarding to Vercel, so by the time a
// request reaches Next.js every trace of the real domain is gone. The browser
// always knows, though — so the sign-in form sends its own origin and we check
// it against this list rather than trusting it outright (an unvalidated
// caller-supplied redirect origin is an open redirect, and this one ends up in
// an OAuth redirectTo).
const PUBLIC_HOSTS = new Set([
  "dashforlife.org",
  "dashoflife.org",
  "red-list-dashboard.vercel.app",
  "red.cst.cam.ac.uk",
  "en.ki",
]);

// Vercel preview deployments: both the stable git-branch alias and the
// per-deployment hash, which changes on every push.
const PREVIEW_HOST_SUFFIX = "-shaneweiszs-projects.vercel.app";

const DEV_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isKnownHostname(hostname: string): boolean {
  const bare = hostname.replace(/^www\./, "");
  return (
    PUBLIC_HOSTS.has(bare) ||
    bare.endsWith(PREVIEW_HOST_SUFFIX) ||
    DEV_HOSTNAMES.has(bare)
  );
}

/**
 * The origin to send users back to after an external redirect (OAuth).
 *
 * Prefers `clientOrigin` — the browser-reported `window.location.origin`, the
 * only source that survives a Host-rewriting proxy — but only when it names a
 * host we recognise. Anything else falls back to the request headers, which is
 * correct for every domain Vercel serves directly.
 */
export function resolvePublicOrigin(
  clientOrigin: unknown,
  fallback: { host: string | null; protocol: string }
): string {
  if (typeof clientOrigin === "string" && clientOrigin !== "") {
    try {
      const url = new URL(clientOrigin);
      if (
        (url.protocol === "https:" || url.protocol === "http:") &&
        isKnownHostname(url.hostname)
      ) {
        return url.origin;
      }
    } catch {
      // Not a parseable URL — fall through to the header-derived origin.
    }
  }

  return `${fallback.protocol}://${fallback.host}`;
}

/**
 * Narrow an untrusted `?next=` value to a path that can only ever redirect
 * within this site.
 *
 * This matters because the auth callback redirects *relatively* (see
 * app/auth/callback/route.ts): "//evil.com" and "/\evil.com" — which browsers
 * normalise to the same thing — are protocol-relative URLs, so as a bare
 * Location they leave the site entirely. Only a single leading slash is
 * same-origin.
 *
 * Takes `unknown` because one caller is `formData.get("next")`, which is a
 * `File` rather than a string if the field name ever collides with an upload.
 */
export function safeRedirectPath(next: unknown): string {
  if (typeof next !== "string") return "/";
  if (!next || next[0] !== "/" || next[1] === "/" || next[1] === "\\") return "/";
  return next;
}

/**
 * The OAuth `redirectTo` — where the provider sends the browser once the user
 * has approved, i.e. this app's auth callback, carrying the page to land on.
 *
 * `next` is sanitised here *and* again in the callback route, and both are
 * load-bearing: this call keeps an attacker-chosen absolute URL out of the
 * `redirectTo` we hand to Supabase, and the callback's call covers the fact
 * that the value comes back to us over the open internet — the provider echoes
 * whatever query string it was given, and nothing stops someone linking
 * straight at /auth/callback with a `next` of their own.
 *
 * The encoding matters too: `next` is itself a path *with a query string*
 * (the dashboard keeps all of its filter state there), so its `?` and `&` have
 * to be escaped or the callback URL's own parser would truncate it at the
 * first one and split the rest into unrelated params.
 *
 * "/" is left off entirely rather than encoded, so the overwhelmingly common
 * case produces the exact same URL it always has. That matters operationally:
 * Supabase matches `redirectTo` against the Redirect URLs allow-list in its
 * dashboard, so a plain sign-in keeps working even where that list hasn't yet
 * been widened to tolerate the new query param.
 */
export function authCallbackUrl(origin: string, next: unknown): string {
  const path = safeRedirectPath(next);
  const callback = `${origin}/auth/callback`;
  return path === "/" ? callback : `${callback}?next=${encodeURIComponent(path)}`;
}
