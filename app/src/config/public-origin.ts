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
 */
export function safeRedirectPath(next: string | null | undefined): string {
  if (!next || next[0] !== "/" || next[1] === "/" || next[1] === "\\") return "/";
  return next;
}
