/**
 * Where a Catalogue of Life record came from — the provenance block CoL shows
 * on a taxon page ("Taxonomic scrutiny", "Source", "Original record"), for the
 * ⚑ tooltip on the dashboard.
 *
 * None of this is in our own backbone: build-backbone reads NameUsage.tsv, which
 * carries names and ranks, not sectors. It takes three ChecklistBank calls to
 * assemble — taxon → sector → source dataset — which is why it lives behind one
 * route rather than being fetched from the browser.
 *
 * Cached twice over: an edge cache on the response, and process-lifetime maps
 * here. CoL only changes this on a release, and the sector→source hop is shared
 * by every species from the same source, so a family's worth of hovers costs one
 * extra call rather than one each.
 */
import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";

/** The CoL release ChecklistBank serves as the current one. */
const COL_DATASET = "3LR";
const API = "https://api.checklistbank.org";
const TIMEOUT_MS = 6000;

export interface ColProvenance {
  /** "Bieler, Rüdiger" — who vetted the record, when CoL records it. */
  scrutinizer?: string;
  scrutinizerDate?: string;
  /** "WoRMS Mollusca" / "MolluscaBase" — the source dataset CoL took it from. */
  sourceAlias?: string;
  sourceTitle?: string;
  /** Source's self-reported completeness, shown as a percentage by CoL. */
  completeness?: number;
  /** The record on the source's own site. */
  link?: string;
  /** ChecklistBank key for the source dataset, so the UI can link to its CoL page. */
  sourceKey?: number;
}

// Process-lifetime, and deliberately unbounded: both are keyed by ids from one
// CoL release, so the ceiling is the number of sectors (a few thousand), not
// the number of species.
const sectorToSource = new Map<number, number | null>();
const sourceMeta = new Map<number, { alias?: string; title?: string; completeness?: number }>();

async function getJson(path: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API}${path}`, { signal: controller.signal, headers: { accept: "application/json" } });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    // A slow or unreachable ChecklistBank must not break the tooltip — the
    // caller renders the rest and simply omits this block.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: NextRequest) {
  const colId = request.nextUrl.searchParams.get("colId");
  if (!colId || !/^[A-Za-z0-9]{1,20}$/.test(colId)) {
    return NextResponse.json({ error: "colId required" }, { status: 400 });
  }

  const taxon = await getJson(`/dataset/${COL_DATASET}/taxon/${colId}`);
  if (!taxon) return NextResponse.json({}, { headers: CACHE_1H });

  const out: ColProvenance = {};
  if (typeof taxon.scrutinizer === "string") out.scrutinizer = taxon.scrutinizer;
  if (typeof taxon.scrutinizerDate === "string") out.scrutinizerDate = taxon.scrutinizerDate;
  if (typeof taxon.link === "string") out.link = taxon.link;

  const sectorKey = typeof taxon.sectorKey === "number" ? taxon.sectorKey : null;
  if (sectorKey != null) {
    if (!sectorToSource.has(sectorKey)) {
      const sector = await getJson(`/dataset/${COL_DATASET}/sector/${sectorKey}`);
      sectorToSource.set(sectorKey, typeof sector?.subjectDatasetKey === "number" ? sector.subjectDatasetKey : null);
    }
    const sourceKey = sectorToSource.get(sectorKey) ?? null;
    if (sourceKey != null) {
      if (!sourceMeta.has(sourceKey)) {
        const src = await getJson(`/dataset/${COL_DATASET}/source/${sourceKey}`);
        sourceMeta.set(sourceKey, {
          alias: typeof src?.alias === "string" ? src.alias : undefined,
          title: typeof src?.title === "string" ? src.title : undefined,
          completeness: typeof src?.completeness === "number" ? src.completeness : undefined,
        });
      }
      const meta = sourceMeta.get(sourceKey);
      if (meta?.alias != null) out.sourceAlias = meta.alias;
      if (meta?.title != null) out.sourceTitle = meta.title;
      if (meta?.completeness != null) out.completeness = meta.completeness;
      out.sourceKey = sourceKey;
    }
  }

  return NextResponse.json(out, { headers: CACHE_1H });
}
