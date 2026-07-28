import { describe, expect, it } from "vitest";
import { resolvePublicOrigin, safeRedirectPath } from "../public-origin";

// What the Caddy-proxied domains look like once Vercel sees them: the real
// domain is gone from the headers entirely.
const PROXIED_HEADERS = {
  host: "red-list-dashboard.vercel.app",
  protocol: "https",
};

describe("resolvePublicOrigin", () => {
  it("uses the browser origin for a proxied domain the headers can't reveal", () => {
    expect(resolvePublicOrigin("https://red.cst.cam.ac.uk", PROXIED_HEADERS)).toBe(
      "https://red.cst.cam.ac.uk"
    );
    expect(resolvePublicOrigin("https://en.ki", PROXIED_HEADERS)).toBe("https://en.ki");
  });

  it("accepts the other production domains, with or without www", () => {
    expect(resolvePublicOrigin("https://dashforlife.org", PROXIED_HEADERS)).toBe(
      "https://dashforlife.org"
    );
    expect(resolvePublicOrigin("https://www.dashoflife.org", PROXIED_HEADERS)).toBe(
      "https://www.dashoflife.org"
    );
  });

  it("accepts Vercel preview deployments and localhost", () => {
    expect(
      resolvePublicOrigin(
        "https://redlist-dashboard-git-some-branch-shaneweiszs-projects.vercel.app",
        PROXIED_HEADERS
      )
    ).toBe("https://redlist-dashboard-git-some-branch-shaneweiszs-projects.vercel.app");
    expect(
      resolvePublicOrigin("http://localhost:3000", { host: "localhost:3000", protocol: "http" })
    ).toBe("http://localhost:3000");
  });

  it("ignores an unknown origin rather than redirecting sign-in off-site", () => {
    expect(resolvePublicOrigin("https://evil.com", PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
    // A lookalike that merely contains a known host as a substring.
    expect(resolvePublicOrigin("https://red.cst.cam.ac.uk.evil.com", PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
    // ...and one that merely ends with the preview suffix's domain.
    expect(resolvePublicOrigin("https://evil-shaneweiszs-projects.vercel.app.evil.com", PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
  });

  it("ignores non-http(s) schemes", () => {
    expect(resolvePublicOrigin("javascript://red.cst.cam.ac.uk", PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
  });

  it("falls back to the headers when the form field is missing or unusable", () => {
    // No JavaScript ran, so the hidden field posted empty.
    expect(resolvePublicOrigin("", PROXIED_HEADERS)).toBe("https://red-list-dashboard.vercel.app");
    expect(resolvePublicOrigin(null, PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
    // FormData.get returns a File when the field name collides with an upload.
    expect(resolvePublicOrigin(new Blob(), PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
    expect(resolvePublicOrigin("not a url", PROXIED_HEADERS)).toBe(
      "https://red-list-dashboard.vercel.app"
    );
  });

  it("keeps working for domains Vercel serves directly", () => {
    expect(
      resolvePublicOrigin(undefined, { host: "dashforlife.org", protocol: "https" })
    ).toBe("https://dashforlife.org");
  });
});

describe("safeRedirectPath", () => {
  it("passes through a normal in-app path, query and fragment included", () => {
    expect(safeRedirectPath("/browse?taxon=Aves#top")).toBe("/browse?taxon=Aves#top");
  });

  it("rejects protocol-relative and absolute URLs that would leave the site", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
    // Browsers normalise backslashes to slashes, so this is "//evil.com" too.
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
    expect(safeRedirectPath("https://evil.com")).toBe("/");
  });

  it("defaults to the home page when absent or empty", () => {
    expect(safeRedirectPath(null)).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath("")).toBe("/");
  });
});
