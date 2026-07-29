import { describe, expect, it } from "vitest";
import { OAUTH_PROVIDERS, resolveOAuthProvider } from "../oauth-providers";

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
});
