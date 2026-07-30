import { describe, expect, it } from "vitest";
import {
  OAUTH_PROVIDERS,
  VISIBLE_OAUTH_PROVIDERS,
  resolveOAuthProvider,
} from "../oauth-providers";

describe("VISIBLE_OAUTH_PROVIDERS", () => {
  it("leaves hidden providers off the sign-in page", () => {
    expect(VISIBLE_OAUTH_PROVIDERS.map((p) => p.id)).not.toContain("azure");
    expect(VISIBLE_OAUTH_PROVIDERS.every((p) => !p.hidden)).toBe(true);
  });

  it("still offers the providers that aren't hidden", () => {
    expect(VISIBLE_OAUTH_PROVIDERS.map((p) => p.id)).toEqual(["google", "github"]);
  });

  it("is a subset of the full list, not a separate one", () => {
    for (const provider of VISIBLE_OAUTH_PROVIDERS) {
      expect(OAUTH_PROVIDERS).toContain(provider);
    }
  });
});

describe("resolveOAuthProvider", () => {
  it("accepts each provider the sign-in page offers", () => {
    for (const provider of OAUTH_PROVIDERS) {
      expect(resolveOAuthProvider(provider.id)).toBe(provider);
    }
  });

  it("rejects anything not on the list rather than passing it to Supabase", () => {
    // "microsoft" is the plausible near-miss: Supabase's slug for it is "azure",
    // so this is what a hand-written form post would most likely send.
    expect(resolveOAuthProvider("microsoft")).toBeNull();
    expect(resolveOAuthProvider("apple")).toBeNull();
    expect(resolveOAuthProvider("")).toBeNull();
    expect(resolveOAuthProvider(null)).toBeNull();
    expect(resolveOAuthProvider(undefined)).toBeNull();
    // A File is what `formData.get()` returns for a file input, and the form
    // field is caller-controlled, so it need not be a string at all.
    expect(resolveOAuthProvider(new File([], "provider"))).toBeNull();
  });

  it("asks Microsoft for the email scope, since it withholds email otherwise", () => {
    expect(resolveOAuthProvider("azure")?.scopes).toBe("email");
  });

  it("still resolves a hidden provider, so hiding a button can't break a sign-in in flight", () => {
    // azure has no button as of 2026-07-30, but a form post already on its way
    // — or anyone re-submitting a cached page — must still complete rather than
    // fall through to the "unsupported provider" path.
    expect(resolveOAuthProvider("azure")?.id).toBe("azure");
  });
});
