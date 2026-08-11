import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const admin = await isAdmin(supabase, user?.id);

  return NextResponse.json({
    email: user?.email ?? null,
    avatarUrl: user?.user_metadata?.avatar_url ?? null,
    canViewRangeMap: admin,
    // Same check, named for what it is: features gated on admin generally
    // (georeference export/import) shouldn't have to ask about range maps.
    isAdmin: admin,
  });
}
