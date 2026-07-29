// The OAuth providers the sign-in page offers, shared by the button list
// (app/login/SignInForm.tsx) and the server action behind it
// (lib/auth/actions.ts) so the two can't drift apart.

type OAuthProvider = {
  // Supabase's own provider slug, which has to match what's enabled under
  // Authentication → Providers in the Supabase dashboard. Microsoft's is
  // "azure" — named after Azure AD, the former name of Microsoft Entra ID —
  // not "microsoft".
  id: "github" | "google" | "azure";
  label: string;
  // Extra OAuth scopes to request, beyond whatever the provider returns by
  // default. Omitted for providers that need none.
  scopes?: string;
};

// This is the order the buttons appear in, and the first one reads as the
// recommended one — so it leads with whichever works for the most people.
// Google has no gate at all. Microsoft is blocked at organisations that disable
// third-party user consent (Cambridge's tenant does, answering "Approval
// required"), which is common at universities and NGOs. GitHub is a developer
// account most of this audience won't have, and the few people already signed
// in that way know where to look.
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  { id: "google", label: "Google" },
  // Azure only returns an email claim if the email scope is asked for
  // explicitly, and the rest of the app leans on email throughout — it labels
  // the account menu, it's the fallback avatar initial, and it's how an
  // account is looked up to grant the admin role in user_roles. A Microsoft
  // user without one would sign in to a half-broken session.
  { id: "azure", label: "Microsoft", scopes: "email" },
  { id: "github", label: "GitHub" },
];

/**
 * Narrow the untrusted `provider` field posted by the sign-in form to one of
 * the providers above, or null.
 *
 * The value is caller-controlled form data that goes straight into a Supabase
 * call which redirects the browser off-site, so it gets the same treatment as
 * the origin posted alongside it (see resolvePublicOrigin): checked against a
 * fixed list rather than trusted.
 */
export function resolveOAuthProvider(value: unknown): OAuthProvider | null {
  return OAUTH_PROVIDERS.find((provider) => provider.id === value) ?? null;
}
