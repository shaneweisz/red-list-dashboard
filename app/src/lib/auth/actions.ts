"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveOAuthProvider } from "@/config/oauth-providers";
import { resolvePublicOrigin } from "@/config/public-origin";
import { createClient } from "@/lib/supabase/server";

export async function signInWithOAuth(formData: FormData) {
  // Which button was pressed. Untrusted input — see resolveOAuthProvider.
  const provider = resolveOAuthProvider(formData.get("provider"));
  if (!provider) {
    redirect("/login?error=oauth_init_failed");
  }

  const supabase = await createClient();

  // Where the provider should send the user back to. This has to be the domain
  // the browser is actually on: the PKCE code verifier is stored in a cookie set
  // on that domain, and if the callback lands anywhere else the cookie isn't
  // sent and the code exchange fails (#416).
  //
  // The Host header alone can't tell us — red.cst.cam.ac.uk and en.ki reach
  // Vercel through a proxy that rewrites Host to red-list-dashboard.vercel.app,
  // so sign-in from those domains used to bounce the user to the vercel.app
  // origin and fail there. The form posts the browser's own origin instead;
  // resolvePublicOrigin validates it and falls back to the headers.
  const headersList = await headers();
  const origin = resolvePublicOrigin(formData.get("origin"), {
    host: headersList.get("x-forwarded-host") ?? headersList.get("host"),
    protocol: headersList.get("x-forwarded-proto") ?? "https",
  });

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.id,
    options: {
      redirectTo: `${origin}/auth/callback`,
      ...(provider.scopes ? { scopes: provider.scopes } : {}),
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth_init_failed");
  }

  redirect(data.url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
