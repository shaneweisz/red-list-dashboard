import { describe, expect, it } from "vitest";
import { authCallbackUrl, resolvePublicOrigin, safeRedirectPath } from "../public-origin";

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

  it("defaults to the home page for a non-string form value", () => {
    // FormData.get returns a File when the field name collides with an upload.
    expect(safeRedirectPath(new Blob())).toBe("/");
  });
});

describe("authCallbackUrl", () => {
  const ORIGIN = "https://red.cst.cam.ac.uk";

  it("leaves the callback URL untouched when there is nothing to return to", () => {
    // Byte-identical to the pre-`next` URL, so a plain sign-in doesn't depend
    // on Supabase's Redirect URLs allow-list having been widened.
    expect(authCallbackUrl(ORIGIN, null)).toBe("https://red.cst.cam.ac.uk/auth/callback");
    expect(authCallbackUrl(ORIGIN, "/")).toBe("https://red.cst.cam.ac.uk/auth/callback");
  });

  it("encodes a filtered dashboard URL so its own query string survives", () => {
    // Unencoded, the `?` and `&` would be read as part of the callback URL's
    // query string rather than as part of `next`'s.
    expect(authCallbackUrl(ORIGIN, "/?taxa=birds&categories=CR,EN")).toBe(
      "https://red.cst.cam.ac.uk/auth/callback?next=%2F%3Ftaxa%3Dbirds%26categories%3DCR%2CEN"
    );
  });

  it("survives the round trip back through the callback route", () => {
    const cases = [
      "/?taxa=mammals&categories=CR,EN&years=11-20+years&search=shrew",
      "/?layout=country&country=ZA&view=new-assessments",
      "/compare?taxa=birds&taxa_b=amphibians",
      "/browse?taxon=Aves#top",
    ];
    for (const path of cases) {
      const url = new URL(authCallbackUrl(ORIGIN, path));
      // What app/auth/callback/route.ts does with the request it receives.
      expect(safeRedirectPath(url.searchParams.get("next"))).toBe(path);
    }
  });

  it("never lets an off-site redirect into the redirectTo", () => {
    expect(authCallbackUrl(ORIGIN, "https://evil.com")).toBe(
      "https://red.cst.cam.ac.uk/auth/callback"
    );
    expect(authCallbackUrl(ORIGIN, "//evil.com")).toBe("https://red.cst.cam.ac.uk/auth/callback");
    expect(authCallbackUrl(ORIGIN, "/\\evil.com")).toBe("https://red.cst.cam.ac.uk/auth/callback");
    expect(authCallbackUrl(ORIGIN, new Blob())).toBe("https://red.cst.cam.ac.uk/auth/callback");
  });

  it("builds on whichever origin the browser actually reported", () => {
    expect(authCallbackUrl("http://localhost:3000", "/?taxa=birds")).toBe(
      "http://localhost:3000/auth/callback?next=%2F%3Ftaxa%3Dbirds"
    );
  });
});
