import type { createClient } from "@/lib/supabase/server";

export type AppRole = "admin";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export async function hasRole(
  supabase: SupabaseServerClient,
  userId: string,
  role: AppRole
): Promise<boolean> {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", role)
    .maybeSingle();
  return !!data;
}

export async function isAdmin(
  supabase: SupabaseServerClient,
  userId: string | null | undefined
): Promise<boolean> {
  if (!userId) return false;
  return hasRole(supabase, userId, "admin");
}
