import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth/roles";
import {
  georeferencesToCsv,
  validateGeoreference,
  type Georeference,
} from "@/lib/georeferences";

export const dynamic = "force-dynamic";

/**
 * Build a Darwin Core CSV of an assessor's own georeferences.
 *
 * The rows are posted from the browser, since that is where they live (see
 * lib/georeferences.ts) — so this route exists for the gate, not the data.
 * Exporting is restricted to admins: a CSV leaving the dashboard is the step
 * IUCN has to approve, and a signed-in account alone isn't the bar — anyone can
 * sign in with a Google address. The check is here, server-side, rather than
 * only hiding the button, so it holds however the endpoint is reached, and so
 * every export leaves an audit line naming who took it.
 *
 * What this deliberately does NOT claim: the underlying GBIF fields are public
 * and already in the page. The gate is on the app producing a file, not on the
 * facts in it.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Sign in to export georeferences" },
      { status: 401 }
    );
  }

  if (!(await isAdmin(supabase, user.id))) {
    return NextResponse.json(
      { error: "Not authorized to export georeferences" },
      { status: 403 }
    );
  }

  let body: { speciesKey?: string; scientificName?: string; georeferences?: Georeference[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const rows = body.georeferences;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "No georeferences to export" }, { status: 400 });
  }

  // Re-validated here rather than trusted: the same rules the editor enforces,
  // applied to whatever actually arrived, so a malformed payload can't produce
  // a file that looks authoritative and isn't.
  const invalid: string[] = [];
  for (const [i, row] of rows.entries()) {
    const { ok, errors } = validateGeoreference({
      decimalLatitude: row?.decimalLatitude ?? null,
      decimalLongitude: row?.decimalLongitude ?? null,
      coordinateUncertaintyInMeters: row?.coordinateUncertaintyInMeters ?? null,
    });
    if (!ok) invalid.push(`Record ${i + 1}: ${errors.join("; ")}`);
    if (!Number.isFinite(row?.gbifID)) invalid.push(`Record ${i + 1}: missing gbifID`);
  }
  if (invalid.length > 0) {
    return NextResponse.json({ error: "Invalid georeferences", details: invalid }, { status: 400 });
  }

  // Audit line: who exported how many records for which species. The point of
  // gating exports is being able to answer that question later.
  console.log(
    `[georeference-export] ${user.email ?? user.id} exported ${rows.length} record(s) for species ${body.speciesKey ?? "unknown"}`
  );

  const stamped = rows.map((row) => ({
    ...row,
    georeferencedBy: row.georeferencedBy || user.email || undefined,
    scientificName: row.scientificName || body.scientificName || undefined,
  }));

  const slug = (body.scientificName ?? body.speciesKey ?? "georeferences")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return new NextResponse(georeferencesToCsv(stamped), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-georeferences.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
