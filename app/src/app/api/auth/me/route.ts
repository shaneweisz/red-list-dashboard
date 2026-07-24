import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRangeMapAuthorized } from "@/lib/auth/range-map-access";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return NextResponse.json({
    email: user?.email ?? null,
    avatarUrl: user?.user_metadata?.avatar_url ?? null,
    canViewRangeMap: isRangeMapAuthorized(user?.email),
  });
}
