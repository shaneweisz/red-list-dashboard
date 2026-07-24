"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function signInWithGitHub() {
  const supabase = await createClient();

  // Derive the current domain from the Host header (what Vercel's own routing
  // is built on, present on every request) rather than the browser-sent
  // Origin header — Origin proved unreliable across this app's several
  // custom domains (different DNS/proxy paths), occasionally producing a
  // redirectTo Supabase didn't recognize and silently falling back to the
  // Site URL instead of completing sign-in.
  const headersList = await headers();
  const host = headersList.get("x-forwarded-host") ?? headersList.get("host");
  const protocol = headersList.get("x-forwarded-proto") ?? "https";
  const origin = `${protocol}://${host}`;

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${origin}/auth/callback`,
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
