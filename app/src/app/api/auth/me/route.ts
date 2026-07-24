import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    email: user?.email ?? null,
    avatarUrl: user?.user_metadata?.avatar_url ?? null,
    canViewRangeMap: await isAdmin(supabase, user?.id),
  });
}
