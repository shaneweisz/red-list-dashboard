"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { FaInfoCircle, FaExpandAlt, FaCompressAlt, FaChevronRight } from "react-icons/fa";

import { HiOutlineAdjustmentsHorizontal } from "react-icons/hi2";
import TaxaIcon from "@/components/TaxaIcon";
import { CATEGORY_COLORS, CATEGORY_NAMES, CATEGORY_ORDER } from "@/config/taxa";
import {
  hasChildren, findNode, getAncestors, stripNodePrefix, OFFICIAL_IUCN_DESCRIBED_NODE_IDS,
  describeFilter, COL_RELEASE_LABEL, COL_RELEASE_URL, primaryFilterRank, breakdownDisplayName, breakdownHref,
  matchesBreakdownName, speciesMatchesNode,
  type FilterRank, type DescribeFilterSegment,
} from "@/lib/taxonomy-utils";
import { TAXONOMY_VIEWS } from "@/config/taxonomy-views";
import type { RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

// See scripts/build-taxa-summary.ts's classifyNoMatch for what each reason means.
// Modular/additive on top of colBreakdown[].noMatchIds — safe to drop independently
// of the count-only CoL Match / No CoL Match mechanism it rides alongside.
type NoMatchDetail = { id: number; name: string; reason: string; detail?: string; detailId?: number };
const NO_MATCH_REASON_LABEL: Record<string, string> = {
  no_link: "not yet matched to any Catalogue of Life name",
  missing_from_backbone: "its Catalogue of Life match isn't in the current backbone",
  infraspecific: "Catalogue of Life doesn't recognize this as a distinct species — it's currently classified as part of",
  provisional: "matched to a Catalogue of Life name that's only provisionally accepted, not yet fully accepted",
  lumped: "Catalogue of Life treats this as the same species as",
  not_in_base: "not yet in Catalogue of Life's curated checklist",
  extinct_unconfirmed: "Catalogue of Life flags this extinct, but IUCN hasn't confirmed Extinct/Extinct in the Wild",
  classified_elsewhere: "Catalogue of Life classifies this under a different name here",
};

// See scripts/build-taxa-summary.ts's SPLIT_CANDIDATES_SQL for the mechanism and its
// caveats — a name-pattern heuristic (former-subspecies synonym → promoted species),
// not a confirmed taxonomic changelog, so it's worded as "likely" rather than stated
// as fact. Modular/additive on top of colBreakdown[].splitDetails — keyed by col_id
// since Not Evaluated species have no sis_taxon_id.
type SplitDetail = { colId: string; parentId: number; parentName: string; parentCategory: string };

interface Table1aRowData {
  group: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  byCategory: Record<string, number>;
  gbifSpeciesCount?: number;
  gbifNeSpeciesCount?: number;
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  colDescribed?: number;
  colNe?: number;
  colBreakdown?: { name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[]; noMatchDetails?: NoMatchDetail[]; splitDetails?: SplitDetail[] }[];
  /** SSC groups mode only: which real view-root taxon this row's group is a
   * sub-population of (e.g. "mammals", "reptiles") — used to navigate to the
   * right root on click, since SSC group nodes span multiple taxa. */
  parentTaxon?: string;
}

interface Table1aSectionData {
  title: string;
  rows: Table1aRowData[];
  /** SSC mode only — the section's catch-all row id (e.g. "ssc-other-mammals"),
   * so the collapse-to-5 UI can always keep it visible regardless of collapse
   * state. Undefined in Table 1a mode, which has no catch-all concept. */
  catchAllId?: string;
}

const IUCN_SOURCE_URL = "https://nc.iucnredlist.org/redlist/content/attachment_files/2026-1_RL_Table1a.pdf";

// SSC groups mode — one section per taxon that has an SSC pilot built out.
// Add an entry here (nodeId, parentTaxon, title, catch-all id) when a new
// taxon's SSC groups are added.
// Named groups shown per section before collapsing behind "Show all" — the
// catch-all row is never counted against this and always stays visible.
const SSC_SECTION_COLLAPSE_SIZE = 5;
const SSC_SECTIONS: { nodeId: string; parentTaxon: string; title: string; catchAllId: string }[] = [
  { nodeId: "ssc-groups", parentTaxon: "mammals", title: "MAMMAL SPECIALIST GROUPS", catchAllId: "ssc-other-mammals" },
  { nodeId: "ssc-reptile-groups", parentTaxon: "reptiles", title: "REPTILE SPECIALIST GROUPS", catchAllId: "ssc-snake-lizard-rla" },
  { nodeId: "ssc-fish-groups", parentTaxon: "fishes", title: "FISH SPECIALIST GROUPS", catchAllId: "ssc-other-fish" },
  { nodeId: "ssc-invertebrate-groups", parentTaxon: "invertebrates", title: "INVERTEBRATE SPECIALIST GROUPS", catchAllId: "ssc-other-invertebrates" },
  { nodeId: "ssc-plant-groups", parentTaxon: "plantae", title: "PLANT SPECIALIST GROUPS", catchAllId: "ssc-other-plants" },
  { nodeId: "ssc-fungi-groups", parentTaxon: "fungi", title: "FUNGI SPECIALIST GROUPS", catchAllId: "ssc-other-fungi" },
];

// Ordered categories for the breakdown bar (most threatened first)
const BAR_CATEGORIES = Object.keys(CATEGORY_ORDER).sort(
  (a, b) => CATEGORY_ORDER[a] - CATEGORY_ORDER[b]
);

interface TaxonSummary {
  id: string;
  name: string;
  color: string;
  estimatedDescribed: number;
  available: boolean;
  totalAssessed: number;
  percentAssessed: number;
  outdated: number;
  percentOutdated: number;
  lastUpdated: string | null;
  byCategory: Record<string, number>;
  totalGbifObservations?: number;
  meanGbifObsPerSpecies?: number;
  medianGbifObsPerSpecies?: number;
  gbifSpeciesCount?: number;
  gbifNeSpeciesCount?: number;
  gbifObsDistribution?: Record<string, number>;
  colDescribed?: number;
  colNe?: number;
}

interface SubGroupSummary {
  id: string;
  name: string;
  estimatedDescribed: number;
  totalAssessed: number;
  outdated: number;
  gbifNeSpeciesCount: number;
  byCategory: Record<string, number>;
  colDescribed?: number;
  colNe?: number;
  colBreakdown?: { name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[]; noMatchDetails?: NoMatchDetail[]; splitDetails?: SplitDetail[] }[];
}

interface Props {
  onToggleTaxon: (taxonId: string, event: React.MouseEvent) => void;
  selectedTaxa: Set<string>;
  selectedSubgroups: Set<string>;
  onToggleSubgroup: (subgroupId: string) => void;
  /** Navigate directly to a taxon + subgroup (used by Table 1a click-through) */
  onNavigateToSubgroup?: (taxonId: string, subgroupId: string) => void;
  disableAllSpecies?: boolean;
  viewMode?: "reassessments" | "new-assessments";
  /** Table 1a mode / SSC groups mode — URL-synced (see useFilterParams) so it
   * survives reload/share and the browser back button can return to it. */
  layoutMode: "table1a" | "ssc" | null;
  onLayoutModeChange: (mode: "table1a" | "ssc" | null) => void;
}

// Dynamic: any tree node with children is expandable
const isExpandable = (id: string) => hasChildren(id);

// Expand affordance for tree rows: a chevron that points right when collapsed and rotates
// down when expanded, so it's obvious a row drills into sub-groups. Leaf rows get a
// same-width spacer to keep names aligned with their expandable siblings.
const expandToggle = (expandable: boolean, expanded: boolean) =>
  expandable ? (
    <FaChevronRight
      aria-hidden
      className={`flex-shrink-0 w-2.5 h-2.5 text-zinc-400 dark:text-zinc-500 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
    />
  ) : (
    <span aria-hidden className="flex-shrink-0 w-2.5" />
  );

// Bar color helpers
const getAssessedBarColor = (percent: number) =>
  percent >= 50 ? "#22c55e" : percent >= 20 ? "#eab308" : "#ef4444";

const getOutdatedBarColor = (percent: number) =>
  percent < 10 ? "#22c55e" : percent < 50 ? "#eab308" : "#ef4444";

// Sticky cell classes for the pinned taxon column
const stickyClasses = "sticky left-0 z-10";
// Compact cell classes for tighter table spacing
const cellPad = "px-2 sm:px-3 py-2 md:px-4 md:py-2.5";
const colDivider = "border-l border-zinc-200 dark:border-zinc-700";
const numericTdNoDividerClasses = `${cellPad} text-right whitespace-nowrap w-0`;
const numericThNoDividerClasses = `${cellPad} text-right text-sm font-bold text-zinc-600 dark:text-zinc-300 whitespace-nowrap w-0`;
const numericTdClasses = `${numericTdNoDividerClasses} ${colDivider}`;
const numericThClasses = `${numericThNoDividerClasses} ${colDivider}`;
const flexTdClasses = `${cellPad} ${colDivider} whitespace-nowrap w-0`;
const flexThClasses = `${cellPad} ${colDivider} text-left text-sm font-bold text-zinc-600 dark:text-zinc-300 whitespace-nowrap w-0`;
// Bar-column headers (Assessed / Outdated / Unassessed / Not Evaluated) are allowed
// to wrap: their cells already carry a bar min-width, so a long single-line header
// (e.g. "# Outdated (>10 yrs old)") would otherwise force the column wider than
// it needs to be and push the table into horizontal overflow.
const centeredThClasses = `${cellPad} ${colDivider} text-center text-sm font-bold text-zinc-600 dark:text-zinc-300 w-0`;
// "# Described Species" is the widest single-line header after the taxon name
// column; letting it wrap (like the bar-column headers above) keeps the column
// from being wider than its numeric content actually needs.
const numericThWrapClasses = `${cellPad} text-right text-sm font-bold text-zinc-600 dark:text-zinc-300 w-0 max-w-[110px]`;

// Toggleable column IDs (Taxon is always visible)
type ColumnId = "described" | "colDescribed" | "assessed" | "outdated" | "breakdown" | "gbifUnassessed" | "colNe" | "totalGbifObs" | "meanGbifObs" | "medianGbifObs" | "gbifDistribution";

const COLUMN_LABELS: Record<ColumnId, string> = {
  described: "# Described Species",
  colDescribed: "# Described Species (CoL)",
  assessed: "# Red List Assessed",
  outdated: "# Outdated (>10 yrs old)",
  breakdown: "Conservation Status Breakdown",
  gbifUnassessed: "# Unassessed, 1+ GBIF Obs",
  colNe: "# Not Evaluated",
  totalGbifObs: "Total Obs",
  meanGbifObs: "Mean Obs",
  medianGbifObs: "Median Obs",
  gbifDistribution: "Obs Distribution",
};

const DISTRIBUTION_BIN_LABELS = ["1", "2–10", "11–100", "101–1K", "1K–10K", "10K–100K", "100K–1M", ">1M"];

type FocusMode = "redlist" | "gbif" | "new-assessments";

// "# Described (CoL)" is hidden by default in every focus — the IUCN/CoL toggle on
// the "# Described" header flips the primary column's source instead. Enable this
// column via the cog menu to see IUCN and CoL described counts side by side.
const FOCUS_HIDDEN: Record<FocusMode, Set<ColumnId>> = {
  redlist: new Set(["colDescribed", "colNe", "gbifUnassessed", "totalGbifObs", "meanGbifObs", "medianGbifObs", "gbifDistribution", "breakdown"]),
  gbif: new Set(["colDescribed", "outdated", "breakdown"]),
  "new-assessments": new Set(["colDescribed", "outdated", "breakdown", "gbifUnassessed", "totalGbifObs", "meanGbifObs", "medianGbifObs", "gbifDistribution"]),
};

function DisabledAllTooltip() {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (hovered && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      setPos({ top: rect.top, left: rect.right + 8 });
    }
  }, [hovered]);

  return (
    <span
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="ml-1 text-zinc-400 dark:text-zinc-500 cursor-help"
    >
      <svg className="w-3.5 h-3.5 inline" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {hovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] px-2 py-1 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg whitespace-nowrap"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
        >
          Unassessed species must be loaded per taxon group. Loading all species at once would require very high memory usage and data transfer.
        </div>,
        document.body
      )}
    </span>
  );
}

// Builds the URL for a node's full, filterable species list in RedListView (the same
// destination a table-row click gives) — an escape hatch from SpeciesListPanel's
// lighter-weight view to the full experience (sorting, charts, map, exact filters).
// Opened with target="_blank" like every other popover link, so it doesn't replace
// the caller's place in the current tab.
function nodeSpeciesListHref(
  nodeId: string,
  view: "reassessments" | "new-assessments",
  breakdown?: { rank: FilterRank; name: string; only?: number[]; excl?: number[] },
): string {
  const params = new URLSearchParams();
  params.set("taxa", stripNodePrefix(nodeId));
  if (view === "new-assessments") params.set("view", "new-assessments");
  // Narrows to just this breakdown row (e.g. Rodentia within Small Mammal SG), and
  // optionally to/away-from a small explicit id list (CoL Match / No CoL Match — see
  // parseBreakdownParam/RedListView's taxaFilteredSpecies for how `bd=` is consumed).
  if (breakdown) {
    let bd = `${nodeId}:${breakdown.rank}:${breakdown.name}`;
    if (breakdown.only?.length) bd += `:only:${breakdown.only.join(",")}`;
    else if (breakdown.excl?.length) bd += `:excl:${breakdown.excl.join(",")}`;
    params.set("bd", bd);
  }
  return `/?${params.toString()}`;
}

// Builds a real URL (not a pushState-only path) for a single species' detail view —
// used with target="_blank" so opening a species from the popover doesn't lose the
// caller's place in the current tab.
function speciesHref(nodeId: string, id: number, view: "reassessments" | "new-assessments"): string {
  const params = new URLSearchParams();
  params.set("taxa", stripNodePrefix(nodeId));
  if (view === "new-assessments") params.set("view", "new-assessments");
  params.set("species", String(id));
  return `/?${params.toString()}`;
}

// What SpeciesListPanel is currently showing — captured at click time from the
// specific breakdown row/bucket clicked, so the panel doesn't need to re-derive it.
type PanelBucket = "assessed" | "ne" | "colMatch" | "noColMatch";
interface PanelRequest {
  rank: FilterRank;
  name: string;
  bucket: PanelBucket;
  label: string;
  noMatchIds?: number[];
  noMatchDetails?: NoMatchDetail[];
  splitDetails?: SplitDetail[];
}

const PANEL_PAGE_SIZE = 10;
const PANEL_WIDTH = 300;
const PANEL_GAP = 8;
// A recently-described species not yet having an IUCN assessment is a genuine,
// likely explanation for NE status (assessment backlog) — an old description year
// doesn't reliably explain anything, so this is only surfaced within a recency
// window, not shown for every NE row with a described_year. 10 years mirrors the
// existing "# Outdated (>10 yrs old)" threshold used elsewhere in this dashboard.
const RECENT_DESCRIPTION_YEARS = 10;

// Positions the species-list panel beside the popup it was opened from: to the
// right if there's room, else to the left, else (narrow viewports) directly under
// it — same "best effort, not perfect" approach as the popup's own positioning.
// Takes the popup's ACTUAL rendered rect (not just its {top,left} origin) — the
// popup's width varies with its content (it's max-w-[340px], not a fixed width), so
// assuming the max width left a visible gap for any popup narrower than that.
// Also clamps maxHeight so the panel's own bottom never runs off the viewport the
// way the popup itself used to (see computePopoverPos below) — long species lists
// scroll internally instead of extending past the visible area. `top` is never
// adjusted to fit — same "never flip/reposition, just clamp height" rule as the
// popup, so the panel's position relative to the popup is always predictable.
function computePanelPos(popupRect: { top: number; left: number; right: number }): { top: number; left: number; maxHeight: number } {
  const margin = 8;
  if (typeof window === "undefined") return { top: popupRect.top, left: popupRect.right, maxHeight: 400 };
  let top: number;
  let left: number;
  if (window.innerWidth - popupRect.right - PANEL_GAP >= PANEL_WIDTH) {
    top = popupRect.top;
    left = popupRect.right + PANEL_GAP;
  } else if (popupRect.left - PANEL_GAP >= PANEL_WIDTH) {
    top = popupRect.top;
    left = popupRect.left - PANEL_WIDTH - PANEL_GAP;
  } else {
    top = popupRect.top + 220;
    left = Math.max(8, Math.min(popupRect.left, window.innerWidth - PANEL_WIDTH - 8));
  }
  const maxHeight = Math.max(100, Math.min(window.innerHeight * 0.7, window.innerHeight - top - margin));
  return { top, left, maxHeight };
}

// Positions the "# Described Species" popup itself. Previously this only clamped
// `left`, leaving `top` (and the fixed max-h-[70vh]) free to push the popup's
// bottom edge below the viewport whenever the info icon was near the bottom of the
// screen — the content below the fold was there but unreachable (no scroll target
// visible, no way to see there was more). Now the max-height is derived from actual
// space below the button, so the popup's own internal scroll (not the viewport)
// handles anything that doesn't fit. Always opens downward from the button — never
// flips above it, so its position relative to the row that triggered it is always
// predictable.
function computePopoverPos(rect: { top: number; bottom: number; left: number }): { top: number; left: number; maxHeight: number } {
  const margin = 8;
  const left = Math.min(rect.left, window.innerWidth - 360);
  const preferredMaxHeight = window.innerHeight * 0.7;
  const spaceBelow = window.innerHeight - rect.bottom - 4 - margin;
  return { top: rect.bottom + 4, left, maxHeight: Math.max(100, Math.min(preferredMaxHeight, spaceBelow)) };
}

// Paginated species-level list rendered beside the main popup when a count row
// (Assessed / Not Evaluated / CoL Match / No CoL Match) is clicked — lets a
// specialist scroll through every species in that bucket without leaving the page.
// Fetches the SAME broad per-node species list RedListView itself fetches
// (/api/redlist/species?taxon=...), then narrows client-side with the same
// speciesMatchesNode/matchesBreakdownName functions RedListView uses — no new API
// surface. Cached per (nodeId, assessed|NE) for the component's lifetime, so
// switching between Assessed/CoL Match/No CoL Match (all drawn from the same
// assessed fetch) never re-fetches.
function SpeciesListPanel({
  nodeId,
  request,
  pos,
  onClose,
  panelRef,
}: {
  nodeId: string;
  request: PanelRequest;
  pos: { top: number; left: number; maxHeight: number };
  onClose: () => void;
  panelRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isNe = request.bucket === "ne";
  const cacheRef = useRef<Map<string, RedListSpecies[]>>(new Map());
  const [rows, setRows] = useState<RedListSpecies[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"name" | "date">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    const cacheKey = isNe ? "ne" : "assessed";
    const cached = cacheRef.current.get(cacheKey);
    if (cached) { setRows(cached); return; }
    setRows(null);
    setError(null);
    const controller = new AbortController();
    const qs = new URLSearchParams({ taxon: nodeId });
    if (isNe) qs.set("category", "NE");
    fetch(`/api/redlist/species?${qs.toString()}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Species fetch failed (${res.status})`))))
      .then((data: { species: RedListSpecies[] }) => {
        cacheRef.current.set(cacheKey, data.species);
        setRows(data.species);
      })
      .catch((err) => { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Failed to load species"); });
    return () => controller.abort();
  }, [nodeId, isNe]);

  // Reset pagination/search/sort whenever the *view* changes — keyed on the full
  // bucket/name/rank identity, not just nodeId/isNe, so switching between (say)
  // "1:1 CoL Match" and "No 1:1 CoL Match" (both non-NE, so isNe alone wouldn't
  // change) still resets a stale page number or search term from the last view.
  useEffect(() => {
    setPage(1); // eslint-disable-line react-hooks/set-state-in-effect -- reset when switching bucket/name
    setSearch("");
    setSortBy("name");
    setSortDir("desc");
  }, [nodeId, request.bucket, request.name, request.rank]);

  const filtered = useMemo(() => {
    if (!rows) return null;
    let matched = rows.filter((s) => speciesMatchesNode(s, nodeId) && matchesBreakdownName(s, request.rank, request.name, nodeId));
    if (request.bucket === "colMatch" && request.noMatchIds?.length) {
      const excl = new Set(request.noMatchIds);
      matched = matched.filter((s) => s.sis_taxon_id == null || !excl.has(s.sis_taxon_id));
    } else if (request.bucket === "noColMatch" && request.noMatchIds?.length) {
      const only = new Set(request.noMatchIds);
      matched = matched.filter((s) => s.sis_taxon_id != null && only.has(s.sis_taxon_id));
    }
    return matched;
  }, [rows, nodeId, request]);

  const searched = useMemo(() => {
    if (!filtered) return null;
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((s) => s.scientific_name.toLowerCase().includes(q) || (s.common_name?.toLowerCase().includes(q) ?? false));
  }, [filtered, search]);

  // "date" sorts by assessment year for the assessed/CoL-match buckets, or by CoL
  // description year for the NE bucket (assessment_date is always null there — NE
  // species haven't been assessed). Undated rows sort to the bottom regardless of
  // direction.
  const sorted = useMemo(() => {
    if (!searched) return null;
    const arr = [...searched];
    if (sortBy === "name") {
      arr.sort((a, b) => a.scientific_name.localeCompare(b.scientific_name));
    } else {
      const value = (s: RedListSpecies) => (isNe ? s.described_year : s.assessment_date ? Date.parse(s.assessment_date) : null);
      arr.sort((a, b) => {
        const va = value(a);
        const vb = value(b);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        return sortDir === "desc" ? vb - va : va - vb;
      });
    }
    return arr;
  }, [searched, sortBy, sortDir, isNe]);

  const reasonBySisId = useMemo(() => {
    const m = new Map<number, NoMatchDetail>();
    request.noMatchDetails?.forEach((d) => m.set(d.id, d));
    return m;
  }, [request.noMatchDetails]);

  const splitByColId = useMemo(() => {
    const m = new Map<string, SplitDetail>();
    request.splitDetails?.forEach((d) => m.set(d.colId, d));
    return m;
  }, [request.splitDetails]);

  const total = sorted?.length ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PANEL_PAGE_SIZE));
  const pageRows = sorted ? sorted.slice((page - 1) * PANEL_PAGE_SIZE, page * PANEL_PAGE_SIZE) : [];
  const fullListHref = nodeSpeciesListHref(
    nodeId,
    isNe ? "new-assessments" : "reassessments",
    request.bucket === "colMatch" || request.bucket === "noColMatch"
      ? { rank: request.rank, name: request.name, [request.bucket === "colMatch" ? "excl" : "only"]: request.noMatchIds }
      : { rank: request.rank, name: request.name },
  );

  return createPortal(
    <div
      ref={panelRef}
      className="fixed z-[9999] overflow-y-auto px-3 py-2 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded-lg shadow-lg normal-case text-left"
      style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, maxHeight: pos.maxHeight }}
      onClick={(e) => e.stopPropagation()}
      // Not inside popoverRef (a portal sibling, not a DOM descendant) — the outside-
      // click listener in DescribedInfoIcon only checks popoverRef/btnRef, so stop the
      // mousedown here too (onClick's stopPropagation alone doesn't cover the
      // mousedown phase that listener runs on) or every click inside the panel would
      // close the whole popup+panel before it registers.
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="font-medium">{request.label}</p>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a href={fullListHref} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 underline">
            Open full list ↗
          </a>
          <button type="button" onClick={onClose} className="text-zinc-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
      </div>
      {!error && filtered && filtered.length > 0 && (
        <div className="flex items-center gap-1.5 mb-1.5 text-[11px]">
          <input
            type="text"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search…"
            aria-label="Search species"
            className="flex-1 min-w-0 px-1.5 py-0.5 rounded bg-zinc-900/40 dark:bg-zinc-950/40 text-white placeholder-zinc-500 outline-none focus:ring-1 focus:ring-zinc-500"
          />
          <button
            type="button"
            onClick={() => setSortBy("name")}
            className={`flex-shrink-0 ${sortBy === "name" ? "text-white underline" : "text-zinc-400 hover:text-white"}`}
          >
            Name
          </button>
          <button
            type="button"
            onClick={() => (sortBy === "date" ? setSortDir((d) => (d === "desc" ? "asc" : "desc")) : setSortBy("date"))}
            className={`flex-shrink-0 ${sortBy === "date" ? "text-white underline" : "text-zinc-400 hover:text-white"}`}
            title={isNe ? "Sort by CoL description year" : "Sort by assessment year"}
          >
            {isNe ? "Described Yr" : "Assess. Yr"}
            {sortBy === "date" ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
          </button>
        </div>
      )}
      {error && <p className="text-red-300">{error}</p>}
      {!error && rows === null && (
        <div className="flex justify-center py-3">
          <svg className="animate-spin h-4 w-4 text-zinc-400" viewBox="0 0 24 24" fill="none" aria-label="Loading">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      )}
      {!error && filtered && filtered.length === 0 && <p className="text-zinc-400">No species.</p>}
      {!error && filtered && filtered.length > 0 && sorted && sorted.length === 0 && (
        <p className="text-zinc-400">No species match your search.</p>
      )}
      {!error && sorted && sorted.length > 0 && (
        <>
          <ul className="space-y-1">
            {pageRows.map((s) => {
              const detail = s.sis_taxon_id != null ? reasonBySisId.get(s.sis_taxon_id) : undefined;
              const split = s.col_id != null ? splitByColId.get(s.col_id) : undefined;
              return (
                <li key={s.id}>
                  <a
                    href={speciesHref(nodeId, s.id, isNe ? "new-assessments" : "reassessments")}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-300 hover:text-blue-200 underline"
                  >
                    {s.scientific_name}
                  </a>
                  {s.category && s.category !== "NE" && (
                    <span
                      className="ml-1 px-1 rounded text-[10px] font-medium"
                      style={{ backgroundColor: `${CATEGORY_COLORS[s.category] || "#999"}33`, color: CATEGORY_COLORS[s.category] || "#999" }}
                    >
                      {s.category}
                    </span>
                  )}
                  {s.assessment_date && (
                    <span className="text-zinc-400">{` ${s.assessment_date.slice(0, 4)}`}</span>
                  )}
                  {detail && (
                    <span className="text-zinc-300">
                      {" — "}
                      {NO_MATCH_REASON_LABEL[detail.reason] ?? detail.reason}
                      {detail.detail && (
                        detail.detailId != null ? (
                          <>
                            {" "}
                            <a
                              href={speciesHref(nodeId, detail.detailId, "reassessments")}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-300 hover:text-blue-200 underline"
                            >
                              {detail.detail}
                            </a>
                          </>
                        ) : ` ${detail.detail}`
                      )}
                    </span>
                  )}
                  {split && (
                    <span
                      className="text-zinc-300"
                      title="Heuristic: Catalogue of Life still records this name as a former subspecies of the linked species — not a confirmed taxonomic changelog."
                    >
                      {" — likely split from "}
                      <a
                        href={speciesHref(nodeId, split.parentId, "reassessments")}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-300 hover:text-blue-200 underline"
                      >
                        {split.parentName}
                      </a>
                    </span>
                  )}
                  {!split && isNe && s.described_year != null && new Date().getFullYear() - s.described_year <= RECENT_DESCRIPTION_YEARS && (
                    <span className="text-zinc-300">{` (described in ${s.described_year})`}</span>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-zinc-700">
            <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-30 hover:text-white">
              ‹ Prev
            </button>
            <span className="text-zinc-400">
              {(page - 1) * PANEL_PAGE_SIZE + 1}-{Math.min(page * PANEL_PAGE_SIZE, total)} of {total}
            </span>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-30 hover:text-white">
              Next ›
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  );
}

// The "Assessed" row within one breakdown name — a plain clickable leaf when CoL and
// IUCN agree on the count (the common case), or its own nested expand into CoL
// Match / No CoL Match when they don't, so the split is visible right where it
// happens instead of needing a separate warning affordance. Clicking any count opens
// the species-level panel (onOpenPanel) instead of navigating away.
function AssessedBreakdownRow({
  rank,
  name,
  trueAssessed,
  noMatchIds,
  noMatchDetails,
  onOpenPanel,
}: {
  rank: FilterRank;
  name: string;
  trueAssessed: number;
  noMatchIds: number[];
  noMatchDetails?: NoMatchDetail[];
  onOpenPanel: (request: PanelRequest) => void;
}) {
  const label = breakdownDisplayName(rank, name);
  if (noMatchIds.length === 0) {
    return (
      <li>
        <button
          type="button"
          className="underline decoration-dotted underline-offset-2 hover:text-white"
          onClick={() => onOpenPanel({ rank, name, bucket: "assessed", label: `${label} — Assessed` })}
        >
          Assessed ({trueAssessed})
        </button>
      </li>
    );
  }
  const colMatchCount = trueAssessed - noMatchIds.length;
  return (
    <li>
      Assessed ({trueAssessed})
      <ul className="ml-4 mt-0.5 space-y-0.5">
        <li>
          <button
            type="button"
            className="underline decoration-dotted underline-offset-2 hover:text-white"
            onClick={() => onOpenPanel({ rank, name, bucket: "colMatch", label: `${label} — 1:1 CoL Match`, noMatchIds })}
          >
            1:1 CoL Match ({colMatchCount})
          </button>
        </li>
        <li>
          <button
            type="button"
            className="underline decoration-dotted underline-offset-2 hover:text-white"
            title="Assessed by IUCN, but doesn't cleanly correspond to one counted Catalogue of Life species here — most of these DO have a Catalogue of Life record (see the reason shown per species): a demoted subspecies, a provisionally-accepted name, a taxonomic split/lump, or a coverage gap. Only a small minority have no Catalogue of Life record at all."
            onClick={() => onOpenPanel({ rank, name, bucket: "noColMatch", label: `${label} — No 1:1 CoL Match`, noMatchIds, noMatchDetails })}
          >
            No 1:1 CoL Match ({noMatchIds.length})
          </button>
        </li>
      </ul>
    </li>
  );
}

// Renders a describeFilter() result: plain text, or a link where we resolved a CoL id.
function renderFilterSegs(segs: DescribeFilterSegment[]): React.ReactNode {
  return segs.map((seg, i) =>
    seg.href ? (
      <a
        key={i}
        href={seg.href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-300 hover:text-blue-200 underline"
      >
        {seg.text}
      </a>
    ) : (
      <span key={i}>{seg.text}</span>
    )
  );
}

// Expandable per-name breakdown for the "# Described Species" popover — lets a
// specialist see, for each name in the node's primary filter dimension (e.g. each
// order in Small Mammal SG), how its colDescribed splits into Assessed vs Not
// Evaluated, without leaving the tooltip. Clicking Assessed/Not Evaluated navigates
// to the node's species list in that view, narrowed client-side to just this one
// name via the `bd=` URL param (RedListView's taxaFilteredSpecies) — species are
// already fully fetched per node, so no new API param was needed.
function BreakdownList({
  rank,
  label,
  breakdown,
  onOpenPanel,
}: {
  rank: FilterRank;
  label: string;
  breakdown: { name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[]; noMatchDetails?: NoMatchDetail[]; splitDetails?: SplitDetail[] }[];
  onOpenPanel: (request: PanelRequest) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (name: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  return (
    <div className="mt-1">
      <p className="text-zinc-300">{label}:</p>
      <ul className="mt-0.5">
        {breakdown.map((b) => {
          const isOpen = expanded.has(b.name);
          const href = breakdownHref(rank, b.name);
          return (
            <li key={b.name} className="mt-0.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggle(b.name)}
                  className="flex items-center gap-1 hover:text-white"
                >
                  <FaChevronRight size={7} className={`text-zinc-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
                  {breakdownDisplayName(rank, b.name)} ({b.count})
                </button>
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-zinc-400 hover:text-blue-300"
                    title={`View ${breakdownDisplayName(rank, b.name)} on Catalogue of Life`}
                  >
                    <FaInfoCircle size={9} />
                  </a>
                )}
              </div>
              {isOpen && (
                <ul className="ml-4 mt-0.5 space-y-0.5">
                  <AssessedBreakdownRow
                    rank={rank}
                    name={b.name}
                    trueAssessed={b.trueAssessed}
                    noMatchIds={b.noMatchIds}
                    noMatchDetails={b.noMatchDetails}
                    onOpenPanel={onOpenPanel}
                  />
                  <li>
                    <button
                      type="button"
                      className="underline decoration-dotted underline-offset-2 hover:text-white"
                      onClick={() => onOpenPanel({ rank, name: b.name, bucket: "ne", label: `${breakdownDisplayName(rank, b.name)} — Not Evaluated`, splitDetails: b.splitDetails })}
                    >
                      Not Evaluated ({b.neCount})
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// "# Described Species" info icon — click-to-open (not hover), so the popover stays
// put while the user moves the mouse onto it to read/click a link. An earlier
// hover-only version (CSS :hover + an offset tooltip) made the tooltip vanish the
// instant the cursor left the tiny icon, before it reached the tooltip — any gap
// between a hover trigger and its target does this, there's no CSS-only fix that
// survives a real mouse gap. Portal-rendered (mirrors the column-visibility menu
// pattern above) so it isn't clipped by the table's scroll/sticky ancestors.
function DescribedInfoIcon({ nodeId, source, breakdown }: { nodeId: string; source: "iucn" | "col"; breakdown?: { name: string; count: number; neCount: number; trueAssessed: number; noMatchIds: number[]; noMatchDetails?: NoMatchDetail[]; splitDetails?: SplitDetail[] }[] }) {
  const node = findNode(nodeId);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, maxHeight: 0 });
  // Species-level panel opened by clicking a count row (Assessed/Not Evaluated/CoL
  // Match/No CoL Match) — a sibling of the popup, not nested inside it, so it can
  // sit beside rather than replace the counts view. Closes whenever the popup does.
  const [activePanel, setActivePanel] = useState<PanelRequest | null>(null);
  const [panelPos, setPanelPos] = useState({ top: 0, left: 0, maxHeight: 0 });

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      // Outside click only — deliberately NOT closed by scroll (page or table-body)
      // anymore. It used to close on any scroll to avoid a stale-positioned
      // popover, but position: fixed keeps it correctly anchored to the viewport
      // regardless of what scrolls underneath it, and closing on scroll made it
      // impossible to scroll the rest of the page while consulting the popover.
      if (e.type === "mousedown") {
        const target = e.target as Node;
        if (
          popoverRef.current?.contains(target) ||
          panelRef.current?.contains(target) ||
          btnRef.current?.contains(target)
        ) return;
      }
      setOpen(false);
      setActivePanel(null);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  // Keeps the popup pinned to its trigger button (and, via the effect below, the
  // panel pinned to the popup) while the page scrolls underneath — so it stays
  // next to the SSC row it was opened from instead of drifting away as a
  // viewport-fixed element normally would. Ignores scroll events whose target is
  // inside the popover/panel's own overflow-y-auto content (still reachable here
  // since this listens on the capture phase, even though such scrolls don't
  // bubble) — scrolling a long species list shouldn't relocate the whole popup.
  // rAF-throttled since scroll fires far more often than a repaint needs.
  useEffect(() => {
    if (!open) return;
    let rafId: number | null = null;
    const reposition = (e: Event) => {
      if (e.type === "scroll") {
        const target = e.target as Node;
        if (popoverRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      }
      if (rafId != null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        if (btnRef.current) setPos(computePopoverPos(btnRef.current.getBoundingClientRect()));
      });
    };
    document.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("scroll", reposition, true);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [open]);

  // Keeps the species panel pinned to the popup's current rect — re-runs whenever
  // the popup moves (pos changes, e.g. from the scroll-reposition effect above) or
  // a different bucket is opened, so it never lags behind the popup it's beside.
  useEffect(() => {
    if (!open || !activePanel) return;
    const rect = popoverRef.current?.getBoundingClientRect();
    if (rect) setPanelPos(computePanelPos(rect)); // eslint-disable-line react-hooks/set-state-in-effect -- track the popup's DOM position, not React state
  }, [open, activePanel, pos]);

  if (!node) return null;
  if (source === "iucn" && !node.estimatedSource) return null;

  // With a breakdown, describeFilter's primary dimension (e.g. "Family: Bovidae") is
  // hidden — the BreakdownList below shows it instead — leaving just the exclude
  // clause (e.g. "(excluding Bos, Bubalus, ...)") and any CoL note. Rendered AFTER
  // the breakdown list rather than before, so "excluding X, Y, Z" reads as a
  // qualifier on "Family: Bovidae (217)" instead of floating above it with nothing
  // to attach to.
  const filterSegs = source === "col" ? describeFilter(node.filter, nodeId, Boolean(breakdown?.length)) : [];

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (!open && btnRef.current) {
            setPos(computePopoverPos(btnRef.current.getBoundingClientRect()));
          }
          setOpen((v) => !v);
        }}
        className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
      >
        <FaInfoCircle size={10} />
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          className="fixed z-[9999] px-3 py-2 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded-lg shadow-lg normal-case max-w-[340px] overflow-y-auto text-left"
          style={{ top: pos.top, left: pos.left, maxHeight: pos.maxHeight }}
        >
          {source === "iucn" ? (
            <>
              <p>{node.estimatedSource}</p>
              {node.estimatedSourceUrl && (
                <a
                  href={node.estimatedSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-blue-300 hover:text-blue-200 underline"
                >
                  View source
                </a>
              )}
            </>
          ) : (
            <>
              {!breakdown?.length && filterSegs.length > 0 && (
                <p>{renderFilterSegs(filterSegs)}</p>
              )}
              {breakdown?.length ? (() => {
                const dim = primaryFilterRank(node.filter);
                return dim ? (
                  <BreakdownList
                    rank={dim.rank}
                    label={dim.label}
                    breakdown={breakdown}
                    onOpenPanel={setActivePanel}
                  />
                ) : null;
              })() : null}
              {breakdown?.length && filterSegs.length > 0 && (
                <p className="mt-1">{renderFilterSegs(filterSegs)}</p>
              )}
              <p className="mt-1.5 text-zinc-300">
                Source:{" "}
                <a href={COL_RELEASE_URL} target="_blank" rel="noopener noreferrer" className="text-blue-300 hover:text-blue-200 underline">
                  {COL_RELEASE_LABEL}
                </a>
                .
              </p>
            </>
          )}
        </div>,
        document.body
      )}
      {open && activePanel && typeof document !== "undefined" && (
        <SpeciesListPanel
          nodeId={nodeId}
          request={activePanel}
          pos={panelPos}
          onClose={() => setActivePanel(null)}
          panelRef={panelRef}
        />
      )}
    </>
  );
}

export default function TaxaSummary({ onToggleTaxon, selectedTaxa, selectedSubgroups, onToggleSubgroup, onNavigateToSubgroup, disableAllSpecies, viewMode = "reassessments", layoutMode, onLayoutModeChange }: Props) {
  const isNewAssessments = viewMode === "new-assessments";
  const [taxa, setTaxa] = useState<TaxonSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Tracks whether the taxa table is expanded for multi-select.
  // Set to true only when the user Cmd/Ctrl+clicks a taxon row;
  // cleared when the modifier key is released.
  const [taxaExpanded, setTaxaExpanded] = useState(false);
  // Which taxa are expanded to show subgroups (e.g., "reptiles", "fishes")
  const [expandedTaxa, setExpandedTaxa] = useState<Set<string>>(new Set());
  // Fetched subgroup data keyed by taxonId
  const [subgroupData, setSubgroupData] = useState<Record<string, SubGroupSummary[]>>({});
  const [loadingSubgroups, setLoadingSubgroups] = useState<Set<string>>(new Set());
  // Refs to avoid stale closures in toggleExpand
  const subgroupDataRef = useRef(subgroupData);
  subgroupDataRef.current = subgroupData;
  const loadingSubgroupsRef = useRef(loadingSubgroups);
  loadingSubgroupsRef.current = loadingSubgroups;
  const initialFocus: FocusMode = isNewAssessments ? "new-assessments" : "redlist";
  const [focusMode, setFocusMode] = useState<FocusMode>(initialFocus);
  const [hiddenColumns, setHiddenColumns] = useState<Set<ColumnId>>(new Set(FOCUS_HIDDEN[initialFocus]));

  // Sync focus mode when viewMode changes
  useEffect(() => {
    const mode: FocusMode = isNewAssessments ? "new-assessments" : "redlist";
    setFocusMode(mode);
    setHiddenColumns(new Set(FOCUS_HIDDEN[mode]));
  }, [isNewAssessments]);
  const [showColumnMenu, setShowColumnMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const isVisible = (col: ColumnId) => !hiddenColumns.has(col);
  const toggleColumn = (col: ColumnId) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const switchFocus = (mode: FocusMode) => {
    setFocusMode(mode);
    setHiddenColumns(new Set(FOCUS_HIDDEN[mode]));
  };

  const visibleColCount = 1 + (Object.keys(COLUMN_LABELS) as ColumnId[]).filter(isVisible).length;

  // Close column menu on outside click
  useEffect(() => {
    if (!showColumnMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowColumnMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColumnMenu]);

  // Collapse taxa table when Cmd/Ctrl is released after a multi-select click
  useEffect(() => {
    if (!taxaExpanded) return;
    const onKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && !e.ctrlKey) setTaxaExpanded(false);
    };
    const onBlur = () => setTaxaExpanded(false);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [taxaExpanded]);

  // Auto-scroll to show Assessed column on mobile (skip past # Described)
  const autoScroll = useCallback((el: HTMLDivElement) => {
    if (window.innerWidth < 768) {
      const firstDataTh = el.querySelector('thead th:nth-child(2)') as HTMLElement;
      if (firstDataTh) {
        el.scrollLeft = firstDataTh.offsetWidth;
      }
    }
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && taxa.length > 0) {
      // rAF so the scroll is applied after layout settles (otherwise it can
      // land before column widths are known and fail to reveal Assessed).
      requestAnimationFrame(() => autoScroll(el));
    }
  }, [taxa, autoScroll]);

  // Fetch subgroup data when a taxon is expanded
  const toggleExpand = useCallback(async (taxonId: string) => {
    setExpandedTaxa((prev) => {
      const next = new Set(prev);
      if (next.has(taxonId)) {
        next.delete(taxonId);
      } else {
        next.add(taxonId);
      }
      return next;
    });

    // Fetch subgroup data if not already loaded (read from refs to avoid stale closures)
    if (!subgroupDataRef.current[taxonId] && !loadingSubgroupsRef.current.has(taxonId)) {
      setLoadingSubgroups((prev) => new Set(prev).add(taxonId));
      try {
        const res = await fetch(`/api/redlist/taxa-subgroups?nodeId=${taxonId}`);
        if (res.ok) {
          const data = await res.json();
          setSubgroupData((prev) => ({ ...prev, [taxonId]: data.subgroups }));
        }
      } finally {
        setLoadingSubgroups((prev) => {
          const next = new Set(prev);
          next.delete(taxonId);
          return next;
        });
      }
    }
  }, []);

  // Table 1a mode / SSC groups mode — derived from the URL-synced layoutMode
  // prop (see useFilterParams) rather than local state, so a page load or
  // browser back/forward that lands on ?layout=table1a|ssc restores the mode
  // automatically. table1aData/sscData stay local — just a fetch-once cache.
  const table1aMode = layoutMode === "table1a";
  const sscMode = layoutMode === "ssc";
  const [table1aData, setTable1aData] = useState<Table1aSectionData[] | null>(null);
  const [table1aLoading, setTable1aLoading] = useState(false);

  // "# Described" source toggle (#272/#274): IUCN Table 1a estimates vs the CoL
  // backbone described count. For the 8 summary taxa + Table 1a's own rows — the
  // only nodes with a genuinely IUCN-sourced number — this toggle picks between the
  // two, defaulting to IUCN. Every other row (sub-groups, all 36 SSC groups) always
  // shows the CoL-derived count regardless of the toggle: their old "estimated"
  // number was a static third-party citation (MDD, Reptile Database, …) or a
  // hand-typed approximation that never gets re-verified, whereas colDescribed is
  // recomputed from the current CoL backbone on every data sync. See
  // resolveDescribed and OFFICIAL_IUCN_DESCRIBED_NODE_IDS.
  const [describedSource, setDescribedSource] = useState<"iucn" | "col">("iucn");
  const resolveDescribed = useCallback(
    (nodeId: string, estimatedDescribed: number, colDescribed: number | undefined): { value: number; source: "iucn" | "col" } => {
      const isOfficial = OFFICIAL_IUCN_DESCRIBED_NODE_IDS.has(stripNodePrefix(nodeId));
      const useCol = isOfficial ? describedSource === "col" : true;
      // No fallback when colDescribed < totalAssessed: an apparent >100%-assessed row
      // (renderBar clamps the bar itself but still prints the real percentage) is a
      // more honest signal than silently reverting to a static, never-re-verified
      // citation — it means this specific CoL release is missing species IUCN's own
      // assessors already recognize (e.g. the pygmy hippo, or a handful of recent
      // Artiodactyla splits), and that's worth surfacing, not hiding.
      if (useCol && colDescribed != null) return { value: colDescribed, source: "col" };
      return { value: estimatedDescribed, source: "iucn" };
    },
    [describedSource]
  );
  const applySource = useCallback(
    <T extends { estimatedDescribed: number; colDescribed?: number; totalAssessed: number; percentAssessed: number }>(row: T, nodeId: string): T => {
      const { value: described } = resolveDescribed(nodeId, row.estimatedDescribed, row.colDescribed);
      if (described === row.estimatedDescribed) return row;
      return {
        ...row,
        estimatedDescribed: described,
        percentAssessed: described > 0 ? (row.totalAssessed / described) * 100 : 0,
      };
    },
    [resolveDescribed]
  );

  // Separate "all" row from per-taxon rows (needed before early returns for hooks)
  const allTaxon = useMemo(() => {
    const raw = taxa.find((t) => t.id === "all");
    return raw ? applySource(raw, raw.id) : undefined;
  }, [taxa, applySource]);
  const perTaxa = useMemo(() => taxa.filter((t) => t.id !== "all").map(t => applySource(t, t.id)), [taxa, applySource]);

  // Expand all expandable taxa
  const expandAll = useCallback(async () => {
    const expandableTaxaIds = perTaxa.filter(t => isExpandable(t.id)).map(t => t.id);
    setExpandedTaxa(new Set(expandableTaxaIds));
    for (const taxonId of expandableTaxaIds) {
      if (!subgroupDataRef.current[taxonId] && !loadingSubgroupsRef.current.has(taxonId)) {
        setLoadingSubgroups((prev) => new Set(prev).add(taxonId));
        fetch(`/api/redlist/taxa-subgroups?nodeId=${taxonId}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data) setSubgroupData((prev) => ({ ...prev, [taxonId]: data.subgroups }));
          })
          .finally(() => {
            setLoadingSubgroups((prev) => {
              const next = new Set(prev);
              next.delete(taxonId);
              return next;
            });
          });
      }
    }
  }, [perTaxa]);

  const collapseAll = useCallback(() => {
    setExpandedTaxa(new Set());
  }, []);

  // Fetch-if-needed, driven by table1aMode rather than a click handler, so it
  // also runs when the mode is entered via URL load or browser back/forward.
  // Uses a ref (not the loading state) to gate the fetch — including the
  // loading state itself in the deps would re-run this effect the instant
  // setTable1aLoading(true) commits, cancelling the very fetch it just started.
  const table1aFetchStartedRef = useRef(false);
  useEffect(() => {
    if (!table1aMode || table1aData || table1aFetchStartedRef.current) return;
    table1aFetchStartedRef.current = true;
    setTable1aLoading(true);
    fetch("/api/redlist/taxa-summary?table1a=true")
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data) setTable1aData(data.sections); })
      .finally(() => setTable1aLoading(false));
  }, [table1aMode, table1aData]);

  // SSC groups mode — same flat-table layout as Table 1a mode, sourced from
  // the precomputed SSC wrapper nodes' children instead of the top-level
  // Table 1a CSV groups (see SSC_SECTIONS above).
  const [sscData, setSscData] = useState<Table1aSectionData[] | null>(null);
  // Which SSC sections (keyed by title) are expanded past the first
  // SSC_SECTION_COLLAPSE_SIZE rows — collapsed by default so a taxon with 36
  // groups (mammals) doesn't dwarf the page; the catch-all row always shows
  // regardless of this state (see the render loop below).
  const [expandedSscSections, setExpandedSscSections] = useState<Set<string>>(new Set());
  const toggleSscSection = useCallback((title: string) => {
    setExpandedSscSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }, []);
  const [sscLoading, setSscLoading] = useState(false);
  const sscFetchStartedRef = useRef(false);

  useEffect(() => {
    if (!sscMode || sscData || sscFetchStartedRef.current) return;
    sscFetchStartedRef.current = true;
    setSscLoading(true);
    Promise.all(
      SSC_SECTIONS.map((section) =>
        fetch(`/api/redlist/taxa-subgroups?nodeId=${section.nodeId}`)
          .then(res => (res.ok ? res.json() : null))
          .then((data): Table1aSectionData | null => {
            if (!data) return null;
            const rows: Table1aRowData[] = (data.subgroups ?? []).map((sg: SubGroupSummary) => ({
              group: sg.id,
              name: sg.name,
              estimatedDescribed: sg.estimatedDescribed,
              totalAssessed: sg.totalAssessed,
              percentAssessed: sg.estimatedDescribed > 0 ? (sg.totalAssessed / sg.estimatedDescribed) * 100 : 0,
              outdated: sg.outdated,
              percentOutdated: sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0,
              byCategory: sg.byCategory,
              gbifNeSpeciesCount: sg.gbifNeSpeciesCount,
              colDescribed: sg.colDescribed,
              colNe: sg.colNe,
              colBreakdown: sg.colBreakdown,
              parentTaxon: section.parentTaxon,
            }));
            // Sort by # assessed descending, but pin the remainder/catch-all row
            // to the bottom regardless of its own count — it reads as an appendix,
            // not one of the named specialist groups.
            rows.sort((a, b) => {
              if (a.group === section.catchAllId) return 1;
              if (b.group === section.catchAllId) return -1;
              return b.totalAssessed - a.totalAssessed;
            });
            return { title: section.title, rows, catchAllId: section.catchAllId };
          })
      )
    )
      .then((sections) => setSscData(sections.filter((s): s is Table1aSectionData => s != null)))
      .finally(() => setSscLoading(false));
  }, [sscMode, sscData]);

  // Shared flat-table data source for whichever mode (Table 1a / SSC groups) is active
  const flatMode = table1aMode || sscMode;
  const flatData = table1aMode ? table1aData : sscData;
  const flatLoading = table1aMode ? table1aLoading : sscLoading;

  const allExpanded = useMemo(() => perTaxa.filter(t => isExpandable(t.id)).every(t => expandedTaxa.has(t.id)), [perTaxa, expandedTaxa]);

  // Collapse all when returning to landing page (no taxa selected)
  useEffect(() => {
    if (selectedTaxa.size === 0 && selectedSubgroups.size === 0) {
      setExpandedTaxa(new Set());
    }
  }, [selectedTaxa, selectedSubgroups]);

  // Auto-expand ancestor chain when subgroups are selected (e.g. from URL)
  useEffect(() => {
    if (selectedSubgroups.size === 0) return;
    const toExpand = new Set<string>();
    for (const sgId of selectedSubgroups) {
      // Expand all ancestors up to the view root (which is in selectedTaxa)
      for (const ancestorId of getAncestors(sgId)) {
        if (selectedTaxa.has(ancestorId)) break; // Stop at the view root
        if (!expandedTaxa.has(ancestorId)) toExpand.add(ancestorId);
      }
      // Expand the node itself if it has children
      if (hasChildren(sgId) && !expandedTaxa.has(sgId)) {
        toExpand.add(sgId);
      }
    }
    for (const id of toExpand) toggleExpand(id);
    // Deps intentionally limited to selectedSubgroups only:
    // - toggleExpand: stable identity (useCallback with empty deps + refs)
    // - selectedTaxa: would cause re-runs when taxa selection changes, but this
    //   effect only needs to react to subgroup URL changes
    // - expandedTaxa: including it would create an infinite loop since this effect
    //   expands taxa (mutates expandedTaxa), which would re-trigger the effect
  }, [selectedSubgroups]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    async function fetchTaxa() {
      try {
        const res = await fetch("/api/redlist/taxa-summary");
        if (!res.ok) throw new Error("Failed to load taxa");
        const data = await res.json();
        setTaxa(data.taxa);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load taxa");
      } finally {
        setLoading(false);
      }
    }
    fetchTaxa();
  }, []);

  if (loading) {
    // Skeleton rows matching actual table structure
    const skeletonRows = Array.from({ length: 9 }, (_, i) => (
      <tr key={i} className={i === 0 ? "bg-zinc-50/80 dark:bg-zinc-800/60" : ""}>
        <td className={`${stickyClasses} bg-white dark:bg-zinc-900 ${cellPad} w-0`}>
          <div className="flex items-center gap-2">
            <div className="w-[22px] h-[22px] rounded-full bg-zinc-200 dark:bg-zinc-700" />
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded" />
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("colDescribed") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[150px] sm:min-w-[230px] md:min-w-[250px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[150px] sm:min-w-[230px] md:min-w-[250px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[150px] sm:min-w-[230px] md:min-w-[250px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("colNe") && (
          <td className={flexTdClasses}>
            <div className="flex items-center gap-1.5 sm:gap-3 min-w-[150px] sm:min-w-[230px] md:min-w-[250px]">
              <div className="h-4 w-[48px] sm:w-[60px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700" />
              <div className="h-3 w-[44px] sm:w-[52px] bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
            </div>
          </td>
        )}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-20 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}>
            <div className="min-w-[100px] md:min-w-[120px]">
              <div className="h-5 w-full rounded bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}>
            <div className="h-4 w-16 bg-zinc-200 dark:bg-zinc-700 rounded ml-auto" />
          </td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            <div className="min-w-[80px] md:min-w-[100px]">
              <div className="h-4 sm:h-3 w-full rounded-full bg-zinc-200 dark:bg-zinc-700" />
            </div>
          </td>
        )}
      </tr>
    ));

    return (
      <div className="relative bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
        {/* Spinner overlay */}
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-zinc-900/60 z-20">
          <svg
            className="animate-spin h-8 w-8 text-zinc-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        <table className="w-full">
          <thead>
            <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
              <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 ${cellPad} text-center text-sm font-bold text-zinc-600 dark:text-zinc-300 whitespace-nowrap w-0`}>Taxonomic Group</th>
              {isVisible("described") && <th className={numericThNoDividerClasses}># Described Species</th>}
              {isVisible("colDescribed") && <th className={numericThClasses}># Described Species (CoL)</th>}
              {isVisible("assessed") && <th className={centeredThClasses}># Red List Assessed</th>}
              {isVisible("outdated") && <th className={centeredThClasses}># Outdated (&gt;10 yrs old)</th>}
              {isVisible("gbifUnassessed") && <th className={centeredThClasses}># Unassessed, 1+ GBIF Obs</th>}
              {isVisible("colNe") && <th className={centeredThClasses}># Not Evaluated</th>}
              {isVisible("totalGbifObs") && <th className={numericThClasses}>Total Obs</th>}
              {isVisible("gbifDistribution") && <th className={flexThClasses}>Obs Distribution</th>}
              {isVisible("meanGbifObs") && <th className={numericThClasses}>Mean Obs</th>}
              {isVisible("medianGbifObs") && <th className={numericThClasses}>Median Obs</th>}
              {isVisible("breakdown") && <th className={flexThClasses}>Conservation Status Breakdown</th>}
            </tr>
          </thead>
          <tbody>
            {skeletonRows[0]}
            <tr>
              <td colSpan={visibleColCount} className="p-0">
                <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
              </td>
            </tr>
            {skeletonRows.slice(1)}
          </tbody>
        </table>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-4 py-3 rounded-lg">
        {error}
      </div>
    );
  }

  // Calculate totals
  const totalAssessed = perTaxa.reduce((sum, t) => sum + t.totalAssessed, 0);
  const totalOutdated = perTaxa.reduce((sum, t) => sum + t.outdated, 0);
  const totalDescribed = allTaxon?.estimatedDescribed ?? perTaxa.reduce((sum, t) => sum + t.estimatedDescribed, 0);
  const totalPercentAssessed = (totalAssessed / totalDescribed) * 100;
  const totalPercentOutdated = (totalOutdated / totalAssessed) * 100;
  const totalByCategory: Record<string, number> = {};
  for (const t of perTaxa) {
    for (const [cat, count] of Object.entries(t.byCategory || {})) {
      totalByCategory[cat] = (totalByCategory[cat] || 0) + count;
    }
  }
  const totalGbifObs = perTaxa.reduce((sum, t) => sum + (t.totalGbifObservations || 0), 0);
  const totalGbifSpecies = perTaxa.reduce((sum, t) => sum + (t.gbifSpeciesCount || 0), 0);
  const totalGbifNeSpecies = perTaxa.reduce((sum, t) => sum + (t.gbifNeSpeciesCount || 0), 0);
  const totalMeanGbifObs = totalGbifSpecies > 0 ? Math.round(totalGbifObs / totalGbifSpecies) : 0;
  const totalColDescribed = allTaxon?.colDescribed ?? perTaxa.reduce((sum, t) => sum + (t.colDescribed || 0), 0);
  const totalColNe = allTaxon?.colNe ?? perTaxa.reduce((sum, t) => sum + (t.colNe || 0), 0);


  // Column order: Taxon (sticky) | # Described | Assessed | Outdated | Category Breakdown

  // Render a percentage bar (optionally with a count label above)
  const renderBar = (percent: number, barColor: string, isAll: boolean, count?: number, fontWeight?: string) => {
    const clampedPercent = Math.min(100, Math.max(0, percent));
    const fillColor = isAll ? "rgba(255,255,255,0.25)" : barColor;
    const fw = fontWeight || "font-medium";
    return (
      <div className="flex items-center gap-1.5 sm:gap-3 min-w-[150px] sm:min-w-[230px] md:min-w-[250px]">
        {count != null && (
          <span className={`text-sm md:text-base ${fw} tabular-nums text-zinc-700 dark:text-zinc-300 w-[48px] sm:w-[60px] text-right flex-shrink-0`}>
            {count.toLocaleString()}
          </span>
        )}
        <div className="flex-1 min-w-[40px] h-3.5 sm:h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${clampedPercent}%`, backgroundColor: fillColor }}
          />
        </div>
        <span className="text-xs md:text-sm tabular-nums text-zinc-500 dark:text-zinc-400 w-[44px] sm:w-[52px] text-right flex-shrink-0">
          {percent.toFixed(1)}%
        </span>
      </div>
    );
  };

  // Render a stacked category breakdown bar
  const renderBreakdownBar = (byCategory: Record<string, number>) => {
    const total = Object.values(byCategory).reduce((sum, n) => sum + n, 0);
    if (total === 0) return <span className="text-sm md:text-base text-zinc-400">—</span>;

    const segments = BAR_CATEGORIES
      .filter((cat) => (byCategory[cat] || 0) > 0)
      .map((cat) => ({
        cat,
        count: byCategory[cat],
        pct: (byCategory[cat] / total) * 100,
        color: CATEGORY_COLORS[cat] || "#a3a3a3",
        name: CATEGORY_NAMES[cat] || cat,
      }));

    return (
      <div className="min-w-[80px] md:min-w-[100px] relative">
        {/* Visible bar (clipped for rounded corners) */}
        <div className="flex h-4 sm:h-3 rounded-full overflow-hidden bg-zinc-200 dark:bg-zinc-700">
          {segments.map((seg) => (
            <div
              key={seg.cat}
              className="h-full"
              style={{
                width: `${seg.pct}%`,
                backgroundColor: seg.color,
                minWidth: seg.pct > 0 ? "2px" : 0,
              }}
            />
          ))}
        </div>
        {/* Hover zones + tooltips (outside overflow-hidden so tooltips aren't clipped) */}
        <div className="absolute inset-0 flex">
          {segments.map((seg, i) => {
            const isLast = i === segments.length - 1;
            const isFirst = i === 0;
            const posClass = isLast && !isFirst
              ? "right-0"
              : isFirst && !isLast
                ? "left-0"
                : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={seg.cat}
                className="group/seg relative h-full"
                style={{ width: `${seg.pct}%`, minWidth: seg.pct > 0 ? "2px" : 0 }}
              >
                <div className={`absolute ${posClass} bottom-full mb-2 px-2 py-1 text-xs bg-zinc-800 dark:bg-zinc-700 text-white rounded-lg shadow-lg opacity-0 invisible group-hover/seg:opacity-100 group-hover/seg:visible z-50 whitespace-nowrap pointer-events-none`}>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                      style={{ backgroundColor: seg.color }}
                    />
                    <span className="text-zinc-300">{seg.name}</span>
                    <span className="font-medium pl-1">{seg.count.toLocaleString()}</span>
                    <span className="text-zinc-400">({seg.pct.toFixed(1)}%)</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Render a mini histogram for GBIF observation distribution
  const renderDistributionBar = (distribution: Record<string, number>) => {
    const entries = DISTRIBUTION_BIN_LABELS.map((label) => ({ label, count: distribution[label] || 0 }));
    const max = Math.max(...entries.map((e) => e.count));
    if (max === 0) return <span className="text-sm text-zinc-400">—</span>;

    return (
      <div className="min-w-[100px] md:min-w-[120px] relative">
        <div className="flex items-end h-5">
          {entries.map(({ label, count }, i) => {
            const heightPct = (count / max) * 100;
            return (
              <div key={label} className="group/bar relative flex-1 flex items-end h-full">
                <div
                  className={`w-full bg-emerald-500/70 dark:bg-emerald-400/60 transition-colors group-hover/bar:bg-emerald-500 dark:group-hover/bar:bg-emerald-400 ${i === 0 ? "rounded-l-sm" : ""} ${i === entries.length - 1 ? "rounded-r-sm" : ""}`}
                  style={{ height: `${Math.max(heightPct, count > 0 ? 6 : 0)}%` }}
                />
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 px-2 py-1 text-xs bg-zinc-800 dark:bg-zinc-700 text-white rounded-lg shadow-lg opacity-0 invisible group-hover/bar:opacity-100 group-hover/bar:visible z-50 whitespace-nowrap pointer-events-none">
                  <span className="text-zinc-300">{label} obs:</span>{" "}
                  <span className="font-medium">{count.toLocaleString()}</span> species
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // CoL backbone cells (#272): "# Described (CoL)" and "# Not Evaluated". Rendered
  // wherever a row has CoL data; sub-group rows pass undefined → "—" (the node-children
  // endpoint doesn't carry CoL counts). bold matches subtotal/total row weight.
  const colDescribedCell = (value: number | undefined, bold = false) =>
    isVisible("colDescribed") ? (
      <td className={numericTdClasses}>
        <span className={`text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums ${bold ? "font-semibold" : ""}`}>
          {value != null ? value.toLocaleString() : "—"}
        </span>
      </td>
    ) : null;
  // "# Not Evaluated" renders as a progress bar (ne / col_described) with the count,
  // mirroring the assessed column. Falls back to a plain count if there's no
  // denominator, and "—" when the row has no CoL data (sub-groups).
  const colNeCell = (ne: number | undefined, described: number | undefined, opts?: { bold?: boolean; isAllRow?: boolean }) =>
    isVisible("colNe") ? (
      <td className={flexTdClasses}>
        {ne == null ? (
          <span className="text-sm text-zinc-400">—</span>
        ) : (
          // Mirror the Assessed column: a bar over the same (toggled) described
          // denominator + the count, so flipping IUCN↔CoL moves both bars together.
          renderBar(described && described > 0 ? (ne / described) * 100 : 0, "#f59e0b", opts?.isAllRow ?? false, ne, opts?.bold ? "font-semibold" : undefined)
        )}
      </td>
    ) : null;

  // Render a data row
  const renderRow = (
    id: string,
    name: string,
    color: string,
    estimatedDescribed: number,
    assessed: number,
    percentAssessed: number,
    outdated: number,
    percentOutdated: number,
    byCategory: Record<string, number>,
    isSelected?: boolean,
    available = true,
    isAllRow = false,
    gbifObs?: { total?: number; mean?: number; median?: number; speciesCount?: number; gbifNeCount?: number; distribution?: Record<string, number>; colDescribed?: number; colNe?: number }
  ) => {
    const isAllSelected = isAllRow && selectedTaxa.has("all");
    const rowBg = isAllRow
      ? isAllSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-zinc-50/80 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "";
    const isOnLandingPage = selectedTaxa.size === 0 && selectedSubgroups.size === 0;
    const allDisabled = isAllRow && disableAllSpecies && isOnLandingPage;
    const hoverClass = allDisabled
      ? "cursor-not-allowed"
      : isAllRow
        ? "hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
        : available
          ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
          : "opacity-50 cursor-not-allowed";

    const stickyBg = isAllRow
      ? isAllSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-zinc-50 dark:bg-zinc-800/60"
      : isSelected
        ? "bg-zinc-100 dark:bg-zinc-800"
        : "bg-white dark:bg-zinc-900";

    return (
      <tr
        key={id}
        onClick={(e) => {
          if (allDisabled) return;
          if (!isAllRow && !available) return;
          // Expand taxa table when Cmd/Ctrl+clicking a taxon row (not "all")
          if (!isAllRow && (e.metaKey || e.ctrlKey)) {
            setTaxaExpanded(true);
          }
          onToggleTaxon(id, e);
        }}
        className={`transition-colors ${rowBg} ${hoverClass}`}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${stickyBg}`}>
          <div className="flex items-center gap-2">
            {expandToggle(false, false)}
            <TaxaIcon taxonId={id} size={22} className="flex-shrink-0" style={{ color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{name}</span>
            {allDisabled && <DisabledAllTooltip />}
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {estimatedDescribed.toLocaleString()}
            </span>
          </td>
        )}
        {colDescribedCell(gbifObs?.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentAssessed, getAssessedBarColor(percentAssessed), isAllRow, assessed)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBar(percentOutdated, getOutdatedBarColor(percentOutdated), isAllRow, outdated)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {(() => {
              const ne = gbifObs?.gbifNeCount;
              if (ne == null || estimatedDescribed <= 0) return <span className="text-sm md:text-base text-zinc-400">—</span>;
              const pct = (ne / estimatedDescribed) * 100;
              return renderBar(pct, "#3b82f6", isAllRow, ne);
            })()}
          </td>
        )}
        {colNeCell(gbifObs?.colNe, estimatedDescribed, { isAllRow })}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.total != null ? gbifObs.total.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}>
            {gbifObs?.distribution ? renderDistributionBar(gbifObs.distribution) : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.mean != null ? gbifObs.mean.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
              {gbifObs?.median != null ? gbifObs.median.toLocaleString() : "—"}
            </span>
          </td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {available ? (
              renderBreakdownBar(byCategory)
            ) : (
              <span className="text-sm md:text-base text-zinc-400">—</span>
            )}
          </td>
        )}
      </tr>
    );
  };

  // Render an ancestor context row with full data — clicking navigates to that level.
  const renderAncestorRow = (sg: SubGroupSummary, color: string, depth: number, topTaxonId: string, isViewRoot: boolean) => {
    const { value: sgDescribed, source: sgDescribedSource } = resolveDescribed(sg.id, sg.estimatedDescribed, sg.colDescribed);
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    return (
      <tr
        key={`ancestor-${sg.id}`}
        className="transition-colors cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
        onClick={() => {
          onToggleSubgroup(sg.id);
        }}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-white dark:bg-zinc-900`}>
          <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 12}px` }}>
            <TaxaIcon taxonId={sg.id} size={isViewRoot ? 18 : 16} className="flex-shrink-0" style={{ color }} />
            <span className="text-sm text-zinc-700 dark:text-zinc-300">{sg.name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm text-zinc-700 dark:text-zinc-300 tabular-nums inline-flex items-center gap-1">
              {sgDescribed.toLocaleString()}
              <DescribedInfoIcon nodeId={sg.id} source={sgDescribedSource} breakdown={sg.colBreakdown} />
            </span>
          </td>
        )}
        {colDescribedCell(sg.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {sg.totalAssessed > 0
              ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
              ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {colNeCell(sg.colNe, sgDescribed)}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {renderBreakdownBar(sg.byCategory)}
          </td>
        )}
      </tr>
    );
  };

  // Render a standalone subgroup row (used when table is collapsed to a selected subgroup)
  const renderCollapsedSubgroupRow = (taxon: TaxonSummary, sg: SubGroupSummary) => {
    const { value: sgDescribed, source: sgDescribedSource } = resolveDescribed(sg.id, sg.estimatedDescribed, sg.colDescribed);
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    return (
      <tr
        key={`collapsed-${sg.id}`}
        className={`transition-colors bg-zinc-100 dark:bg-zinc-800 ${isExpandable(sg.id) ? "cursor-pointer hover:bg-zinc-200 dark:hover:bg-zinc-700" : ""}`}
        onClick={() => {
          if (isExpandable(sg.id)) {
            toggleExpand(sg.id);
          }
        }}
      >
        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-zinc-100 dark:bg-zinc-800`}>
          <div className="flex items-center gap-2">
            {expandToggle(isExpandable(sg.id), expandedTaxa.has(sg.id))}
            <TaxaIcon taxonId={sg.id} size={18} className="flex-shrink-0" style={{ color: taxon.color }} />
            <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{sg.name}</span>
          </div>
        </td>
        {isVisible("described") && (
          <td className={numericTdNoDividerClasses}>
            <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums inline-flex items-center gap-1">
              {sgDescribed.toLocaleString()}
              <DescribedInfoIcon nodeId={sg.id} source={sgDescribedSource} breakdown={sg.colBreakdown} />
            </span>
          </td>
        )}
        {colDescribedCell(sg.colDescribed)}
        {isVisible("assessed") && (
          <td className={flexTdClasses}>
            {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
          </td>
        )}
        {isVisible("outdated") && (
          <td className={flexTdClasses}>
            {sg.totalAssessed > 0
              ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {isVisible("gbifUnassessed") && (
          <td className={flexTdClasses}>
            {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
              ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
              : <span className="text-sm text-zinc-400">—</span>}
          </td>
        )}
        {colNeCell(sg.colNe, sgDescribed)}
        {isVisible("totalGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("gbifDistribution") && (
          <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("meanGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("medianGbifObs") && (
          <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
        )}
        {isVisible("breakdown") && (
          <td className={flexTdClasses}>
            {renderBreakdownBar(sg.byCategory)}
          </td>
        )}
      </tr>
    );
  };

  // Render a subgroup row, recursively expandable if it has children
  const renderSubgroupRow = (sg: SubGroupSummary, parentColor: string, depth: number, topTaxonId: string): React.ReactNode => {
    const { value: sgDescribed, source: sgDescribedSource } = resolveDescribed(sg.id, sg.estimatedDescribed, sg.colDescribed);
    const sgPctAssessed = sgDescribed > 0 ? (sg.totalAssessed / sgDescribed) * 100 : 0;
    const sgPctOutdated = sg.totalAssessed > 0 ? (sg.outdated / sg.totalAssessed) * 100 : 0;
    const isSgSelected = selectedSubgroups.has(sg.id);
    const sgHasChildren = isExpandable(sg.id);
    const isSgExpanded = expandedTaxa.has(sg.id);
    const sgSubs = subgroupData[sg.id] ?? [];
    const isLoadingSgSubs = loadingSubgroups.has(sg.id);
    return (
      <React.Fragment key={sg.id}>
        <tr
          className={`transition-colors cursor-pointer ${
            isSgSelected
              ? "bg-violet-50 dark:bg-violet-900/20"
              : "hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
          }`}
          onClick={() => {
            if (sgHasChildren && isSgSelected) {
              // Already selected parent → toggle expand/collapse
              toggleExpand(sg.id);
            } else {
              onToggleSubgroup(sg.id);
              if (sgHasChildren && !isSgExpanded) {
                // Selecting → expand to show children
                toggleExpand(sg.id);
              }
            }
          }}
        >
          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSgSelected ? "bg-violet-50 dark:bg-violet-900/20" : "bg-white dark:bg-zinc-900"}`}>
            <div className="flex items-center gap-2" style={{ paddingLeft: `${(depth - 1) * 12}px` }}>
              {expandToggle(sgHasChildren, isSgExpanded)}
              <TaxaIcon taxonId={sg.id} size={depth === 1 ? 16 : 14} className="flex-shrink-0" style={{ color: parentColor, opacity: isSgSelected ? 1 : 0.6 }} />
              <span className={`text-sm ${isSgSelected ? "font-medium text-violet-700 dark:text-violet-300" : "text-zinc-700 dark:text-zinc-300"}`}>{sg.name}</span>
              {isLoadingSgSubs && (
                <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
          </td>
          {isVisible("described") && (
            <td className={numericTdNoDividerClasses}>
              <span className="text-sm text-zinc-600 dark:text-zinc-400 tabular-nums inline-flex items-center gap-1">
                {sgDescribed.toLocaleString()}
                <DescribedInfoIcon nodeId={sg.id} source={sgDescribedSource} breakdown={sg.colBreakdown} />
              </span>
            </td>
          )}
          {colDescribedCell(sg.colDescribed)}
          {isVisible("assessed") && (
            <td className={flexTdClasses}>
              {renderBar(sgPctAssessed, getAssessedBarColor(sgPctAssessed), false, sg.totalAssessed)}
            </td>
          )}
          {isVisible("outdated") && (
            <td className={flexTdClasses}>
              {sg.totalAssessed > 0
                ? renderBar(sgPctOutdated, getOutdatedBarColor(sgPctOutdated), false, sg.outdated)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("gbifUnassessed") && (
            <td className={flexTdClasses}>
              {sg.gbifNeSpeciesCount > 0 && sgDescribed > 0
                ? renderBar((sg.gbifNeSpeciesCount / sgDescribed) * 100, "#3b82f6", false, sg.gbifNeSpeciesCount)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {colNeCell(sg.colNe, sgDescribed)}
          {isVisible("totalGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("gbifDistribution") && (
            <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("meanGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("medianGbifObs") && (
            <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>
          )}
          {isVisible("breakdown") && (
            <td className={flexTdClasses}>
              {renderBreakdownBar(sg.byCategory)}
            </td>
          )}
        </tr>
        {/* Recursively render children if expanded */}
        {isSgExpanded && sgSubs.map((child) => renderSubgroupRow(child, parentColor, depth + 1, topTaxonId))}
      </React.Fragment>
    );
  };

  // Render a taxon row with optional expandable subgroups
  const renderTaxonWithSubgroups = (taxon: TaxonSummary, isSelected: boolean) => {
    const hasSubgroups = isExpandable(taxon.id);
    const isExpanded = expandedTaxa.has(taxon.id);
    const subs = subgroupData[taxon.id] ?? [];
    const isLoadingSubs = loadingSubgroups.has(taxon.id);

    return (
      <React.Fragment key={taxon.id}>
        <tr
          className={`transition-colors ${
            isSelected ? "bg-zinc-100 dark:bg-zinc-800" : ""
          } ${taxon.available ? "hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer" : "opacity-50 cursor-not-allowed"}`}
          onClick={(e) => {
            if (!taxon.available) return;
            if (e.metaKey || e.ctrlKey) setTaxaExpanded(true);
            onToggleTaxon(taxon.id, e);
            if (hasSubgroups) {
              if (isSelected) {
                // Already selected → toggle expand/collapse
                toggleExpand(taxon.id);
              } else {
                // Selecting → show collapsed table view first (don't auto-expand)
                setExpandedTaxa(new Set());
              }
            } else {
              // Non-expandable taxon selected → collapse all expanded
              setExpandedTaxa(new Set());
            }
          }}
        >
          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 ${isSelected ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
            <div className="flex items-center gap-2">
              {/* Only show the expand chevron once the taxon is selected — on the landing
                  page a click selects (doesn't expand yet), so a chevron there misleads. */}
              {expandToggle(hasSubgroups && isSelected, isExpanded)}
              <TaxaIcon taxonId={taxon.id} size={22} className="flex-shrink-0" style={{ color: taxon.color }} />
              <span className="font-medium text-sm md:text-base text-zinc-900 dark:text-zinc-100">{taxon.name}</span>
              {isLoadingSubs && (
                <svg className="animate-spin h-3 w-3 text-zinc-400" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
          </td>
          {isVisible("described") && (
            <td className={numericTdNoDividerClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.estimatedDescribed.toLocaleString()}
              </span>
            </td>
          )}
          {colDescribedCell(taxon.available ? taxon.colDescribed : undefined)}
          {isVisible("assessed") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentAssessed, getAssessedBarColor(taxon.percentAssessed), false, taxon.totalAssessed)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("outdated") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBar(taxon.percentOutdated, getOutdatedBarColor(taxon.percentOutdated), false, taxon.outdated)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("gbifUnassessed") && (
            <td className={flexTdClasses}>
              {taxon.gbifNeSpeciesCount != null && taxon.estimatedDescribed > 0
                ? renderBar((taxon.gbifNeSpeciesCount / taxon.estimatedDescribed) * 100, "#3b82f6", false, taxon.gbifNeSpeciesCount)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {colNeCell(taxon.available ? taxon.colNe : undefined, taxon.estimatedDescribed)}
          {isVisible("totalGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.totalGbifObservations != null ? taxon.totalGbifObservations.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("gbifDistribution") && (
            <td className={flexTdClasses}>
              {taxon.gbifObsDistribution
                ? renderDistributionBar(taxon.gbifObsDistribution)
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
          {isVisible("meanGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.meanGbifObsPerSpecies != null ? taxon.meanGbifObsPerSpecies.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("medianGbifObs") && (
            <td className={numericTdClasses}>
              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                {taxon.medianGbifObsPerSpecies != null ? taxon.medianGbifObsPerSpecies.toLocaleString() : "—"}
              </span>
            </td>
          )}
          {isVisible("breakdown") && (
            <td className={flexTdClasses}>
              {taxon.available
                ? renderBreakdownBar(taxon.byCategory || {})
                : <span className="text-sm text-zinc-400">—</span>}
            </td>
          )}
        </tr>

        {/* Expanded subgroup rows (recursive) */}
        {isExpanded && subs.map((sg) => renderSubgroupRow(sg, taxon.color, 1, taxon.id))}
      </React.Fragment>
    );
  };

  // Table header
  const renderHead = () => (
    <thead>
      <tr className="bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
        <th className={`${stickyClasses} bg-zinc-50 dark:bg-zinc-800 ${cellPad} ${flatMode ? "text-left" : "text-center"} text-sm font-bold text-zinc-600 dark:text-zinc-300 whitespace-nowrap w-0 ${flatMode ? "max-w-[160px] sm:max-w-[240px] lg:max-w-[300px]" : ""}`}>
          <div className={`flex items-center gap-1.5 ${flatMode ? "justify-start" : "justify-center"}`}>
            Taxonomic Group
            <button
              ref={menuButtonRef}
              onClick={(e) => {
                e.stopPropagation();
                if (!showColumnMenu && menuButtonRef.current) {
                  const rect = menuButtonRef.current.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, left: rect.left });
                }
                setShowColumnMenu((v) => !v);
              }}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title="Toggle columns"
            >
              <HiOutlineAdjustmentsHorizontal size={14} />
            </button>
          </div>
        </th>
        {isVisible("described") && (
          <th className={flatMode ? numericThWrapClasses : numericThNoDividerClasses}>
            <span className="inline-flex items-center gap-1">
              # Described Species
              <span className="relative group">
                <a
                  href={describedSource === "col" ? COL_RELEASE_URL : IUCN_SOURCE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  <FaInfoCircle size={12} />
                </a>
                <span className="absolute left-full top-1/2 -translate-y-1/2 ml-2 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible z-50 shadow-lg normal-case">
                  {describedSource === "col"
                    ? `Described species from the ${COL_RELEASE_LABEL} backbone`
                    : "Estimates from IUCN Red List Table 1a (2026-1)"}
                </span>
              </span>
            </span>
          </th>
        )}
        {isVisible("colDescribed") && (
          <th className={numericThClasses}># Described Species (CoL)</th>
        )}
        {isVisible("assessed") && (
          <th className={centeredThClasses}># Red List Assessed</th>
        )}
        {isVisible("outdated") && (
          <th className={centeredThClasses}># Outdated (&gt;10 yrs old)</th>
        )}
        {isVisible("gbifUnassessed") && (
          <th className={centeredThClasses}># Unassessed, 1+ GBIF Obs</th>
        )}
        {isVisible("colNe") && (
          <th className={centeredThClasses}># Not Evaluated</th>
        )}
        {isVisible("totalGbifObs") && (
          <th className={numericThClasses}>Total Obs</th>
        )}
        {isVisible("gbifDistribution") && (
          <th className={flexThClasses}>Obs Distribution</th>
        )}
        {isVisible("meanGbifObs") && (
          <th className={numericThClasses}>Mean Obs</th>
        )}
        {isVisible("medianGbifObs") && (
          <th className={numericThClasses}>Median Obs</th>
        )}
        {isVisible("breakdown") && (
          <th className={flexThClasses}>
            <span className="uppercase">Conservation Status Breakdown</span>
            <div className="flex items-center gap-1.5 mt-1 font-normal normal-case">
              {BAR_CATEGORIES.map((cat) => (
                <span key={cat} className="inline-flex items-center gap-0.5">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ backgroundColor: CATEGORY_COLORS[cat] || "#a3a3a3" }}
                  />
                  <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{cat}</span>
                </span>
              ))}
            </div>
          </th>
        )}
      </tr>
    </thead>
  );

  return (
    <>
    {showColumnMenu && createPortal(
      <div
        ref={menuRef}
        className="fixed bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-[9999] py-1 min-w-[180px]"
        style={{ top: menuPos.top, left: menuPos.left }}
      >
        {!isNewAssessments && (
          <>
            <div className="px-3 pt-2 pb-1.5 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Focus</div>
            <div className="mx-3 mb-1.5 flex rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-600">
              <button
                onClick={() => switchFocus("redlist")}
                className={`flex-1 text-xs py-1 font-medium transition-colors ${focusMode === "redlist" ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
              >
                Red List
              </button>
              <button
                onClick={() => switchFocus("gbif")}
                className={`flex-1 text-xs py-1 font-medium transition-colors ${focusMode === "gbif" ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-zinc-900" : "bg-white text-zinc-500 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"}`}
              >
                GBIF
              </button>
            </div>
            <div className="border-t border-zinc-100 dark:border-zinc-700" />
          </>
        )}
        <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">Columns</div>
        {(Object.keys(COLUMN_LABELS) as ColumnId[]).map((col) => (
          <label
            key={col}
            className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
          >
            <input
              type="checkbox"
              checked={isVisible(col)}
              onChange={() => toggleColumn(col)}
              className="rounded border-zinc-300 dark:border-zinc-600 text-green-600 focus:ring-green-500"
            />
            {COLUMN_LABELS[col]}
          </label>
        ))}
      </div>,
      document.body
    )}
    <div ref={scrollRef} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-x-auto">
      <table className="w-full">
        {renderHead()}
        <tbody>
          {flatMode ? (
            /* Table 1a / SSC groups view: sections with headers, individual rows, subtotals */
            flatLoading ? (
              <tr>
                <td colSpan={visibleColCount} className={`${cellPad} text-center text-sm text-zinc-400`}>
                  <div className="flex items-center justify-center gap-2 py-4">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {table1aMode ? "Loading Table 1a data…" : "Loading SSC groups data…"}
                  </div>
                </td>
              </tr>
            ) : flatData ? (
              <>
                {flatData.map((section, si) => {
                  // Resolve each row's effective described source first (IUCN toggle for
                  // Table 1a's own rows; always CoL for SSC groups — see resolveDescribed),
                  // so the per-row cells and the subtotals below all agree. Keep the
                  // per-row source (describedSource) around too, for the tooltip.
                  const rows = section.rows.map(r => {
                    const { value: described, source } = resolveDescribed(r.group, r.estimatedDescribed, r.colDescribed);
                    return {
                      ...r,
                      estimatedDescribed: described,
                      percentAssessed: described > 0 ? (r.totalAssessed / described) * 100 : 0,
                      describedSource: source,
                    };
                  });
                  // Compute section subtotals
                  const subDescribed = rows.reduce((s, r) => s + r.estimatedDescribed, 0);
                  const subAssessed = rows.reduce((s, r) => s + r.totalAssessed, 0);
                  const subOutdated = rows.reduce((s, r) => s + r.outdated, 0);
                  const subPctAssessed = subDescribed > 0 ? (subAssessed / subDescribed) * 100 : 0;
                  const subPctOutdated = subAssessed > 0 ? (subOutdated / subAssessed) * 100 : 0;
                  const subByCategory: Record<string, number> = {};
                  for (const r of rows) {
                    for (const [cat, count] of Object.entries(r.byCategory || {})) {
                      subByCategory[cat] = (subByCategory[cat] || 0) + count;
                    }
                  }
                  const subGbifSpecies = rows.reduce((s, r) => s + (r.gbifSpeciesCount ?? 0), 0);
                  const subGbifNe = rows.reduce((s, r) => s + (r.gbifNeSpeciesCount ?? 0), 0);
                  const subColDescribed = rows.reduce((s, r) => s + (r.colDescribed ?? 0), 0);
                  const subColNe = rows.reduce((s, r) => s + (r.colNe ?? 0), 0);
                  const subGbifObs = rows.reduce((s, r) => s + (r.totalGbifObservations ?? 0), 0);
                  const subMeanGbif = subGbifSpecies > 0 ? Math.round(subGbifObs / subGbifSpecies) : undefined;

                  return (
                    <React.Fragment key={section.title}>
                      {/* Section header — shows the section's subtotals directly, so they're
                          visible without scrolling past every row to reach the bottom. */}
                      <tr className="bg-zinc-100 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700">
                        <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 bg-zinc-100 dark:bg-zinc-800/80`}>
                          <span className="text-xs font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wider">
                            {section.title}
                          </span>
                        </td>
                        {isVisible("described") && (
                          <td className={numericTdNoDividerClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subDescribed.toLocaleString()}</span>
                          </td>
                        )}
                        {colDescribedCell(subColDescribed, true)}
                        {isVisible("assessed") && (
                          <td className={flexTdClasses}>
                            {renderBar(subPctAssessed, getAssessedBarColor(subPctAssessed), false, subAssessed, "font-semibold")}
                          </td>
                        )}
                        {isVisible("outdated") && (
                          <td className={flexTdClasses}>
                            {subAssessed > 0 ? renderBar(subPctOutdated, getOutdatedBarColor(subPctOutdated), false, subOutdated, "font-semibold") : <span className="text-sm text-zinc-400">—</span>}
                          </td>
                        )}
                        {isVisible("gbifUnassessed") && (
                          <td className={flexTdClasses}>
                            {subGbifNe > 0 && subDescribed > 0
                              ? renderBar((subGbifNe / subDescribed) * 100, "#3b82f6", false, subGbifNe, "font-semibold")
                              : <span className="text-sm text-zinc-400">—</span>}
                          </td>
                        )}
                        {colNeCell(subColNe, subDescribed, { bold: true })}
                        {isVisible("totalGbifObs") && (
                          <td className={numericTdClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subGbifObs.toLocaleString()}</span>
                          </td>
                        )}
                        {isVisible("gbifDistribution") && <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>}
                        {isVisible("meanGbifObs") && (
                          <td className={numericTdClasses}>
                            <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums">{subMeanGbif != null ? subMeanGbif.toLocaleString() : "—"}</span>
                          </td>
                        )}
                        {isVisible("medianGbifObs") && <td className={numericTdClasses}><span className="text-sm text-zinc-400">—</span></td>}
                        {isVisible("breakdown") && (
                          <td className={flexTdClasses}>{renderBreakdownBar(subByCategory)}</td>
                        )}
                      </tr>
                      {/* Section rows — collapsed to SSC_SECTION_COLLAPSE_SIZE named
                          groups by default in SSC mode (a 36-row mammal section would
                          otherwise dwarf every other taxon); the catch-all row is
                          pulled out of the collapse/expand entirely and always shown,
                          since it's usually the largest, most load-bearing row. Table
                          1a mode has no catch-all concept (section.catchAllId is
                          undefined there), so it always renders every row. */}
                      {(() => {
                        const isSscSection = sscMode && section.catchAllId != null;
                        const catchAllRow = isSscSection ? rows.find(r => r.group === section.catchAllId) : undefined;
                        const namedRows = catchAllRow ? rows.filter(r => r.group !== section.catchAllId) : rows;
                        const isExpanded = expandedSscSections.has(section.title);
                        const visibleNamedRows = isSscSection && !isExpanded ? namedRows.slice(0, SSC_SECTION_COLLAPSE_SIZE) : namedRows;
                        const hiddenCount = namedRows.length - visibleNamedRows.length;
                        const renderGroupRow = (row: (typeof rows)[number]) => (
                        <tr
                          key={row.group}
                          className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                          onClick={(e) => {
                            if (sscMode) {
                              // SSC groups are pre-filtered sub-populations of a real view-root
                              // taxon (mammals, reptiles, ...), not display-root taxa themselves —
                              // navigate straight to that root + this group's filter.
                              // onNavigateToSubgroup clears layoutMode atomically as part of the
                              // same history push — don't also clear it here, or the navigation
                              // splits into two separate back-button steps.
                              onNavigateToSubgroup?.(row.parentTaxon ?? "mammals", row.group);
                              return;
                            }
                            const defaultRoots = new Set(TAXONOMY_VIEWS.default.roots);
                            if (defaultRoots.has(row.group)) {
                              // Direct view root (e.g. mammals, birds) — select it. This path
                              // doesn't go through onNavigateToSubgroup, so exit the mode here.
                              onLayoutModeChange(null);
                              onToggleTaxon(row.group, e);
                            } else if (onNavigateToSubgroup) {
                              // Table 1a group under a virtual root (e.g. molluscs → invertebrates).
                              // row.group is a tree node id. Aggregating parent rows (e.g. "insecta",
                              // which spans 8 order CSV groups) match a child by node id; single-group
                              // rows match by CSV group.
                              const stripPrefix = (id: string) => id.replace(/^(inv-|pl-|fu-)/, "");
                              for (const rootId of defaultRoots) {
                                const rootNode = findNode(rootId);
                                const matchingChild =
                                  rootNode?.children?.find(c => stripPrefix(c.id) === row.group)
                                  ?? rootNode?.children?.find(c =>
                                    c.filter.csvGroups.length === 1 && c.filter.csvGroups[0] === row.group
                                  )
                                  ?? rootNode?.children?.find(c =>
                                    c.filter.csvGroups.includes(row.group)
                                  );
                                if (matchingChild) {
                                  onNavigateToSubgroup(rootId, matchingChild.id);
                                  break;
                                }
                              }
                            }
                          }}
                        >
                          <td className={`${stickyClasses} ${cellPad} whitespace-nowrap w-0 max-w-[160px] sm:max-w-[240px] lg:max-w-[300px] bg-white dark:bg-zinc-900`}>
                            <span className="flex items-center gap-1.5 pl-4 min-w-0">
                              <span className="text-sm md:text-base text-zinc-900 dark:text-zinc-100 truncate" title={row.name}>
                                {row.name}
                              </span>
                              {(() => {
                                const sourceUrl = findNode(row.group)?.sourceUrl;
                                if (!sourceUrl) return null;
                                return (
                                  <span className="relative group/row-src flex-shrink-0">
                                    <a
                                      href={sourceUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <FaInfoCircle size={10} />
                                    </a>
                                    <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/row-src:opacity-100 group-hover/row-src:visible z-50 shadow-lg pointer-events-none">
                                      View official IUCN page
                                    </span>
                                  </span>
                                );
                              })()}
                            </span>
                          </td>
                          {isVisible("described") && (
                            <td className={numericTdNoDividerClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums inline-flex items-center gap-1">
                                {row.estimatedDescribed.toLocaleString()}
                                <DescribedInfoIcon nodeId={row.group} source={row.describedSource} breakdown={row.colBreakdown} />
                              </span>
                            </td>
                          )}
                          {colDescribedCell(row.colDescribed)}
                          {isVisible("assessed") && (
                            <td className={flexTdClasses}>
                              {renderBar(row.percentAssessed, getAssessedBarColor(row.percentAssessed), false, row.totalAssessed)}
                            </td>
                          )}
                          {isVisible("outdated") && (
                            <td className={flexTdClasses}>
                              {row.totalAssessed > 0
                                ? renderBar(row.percentOutdated, getOutdatedBarColor(row.percentOutdated), false, row.outdated)
                                : <span className="text-sm text-zinc-400">—</span>}
                            </td>
                          )}
                          {isVisible("gbifUnassessed") && (
                            <td className={flexTdClasses}>
                              {row.gbifNeSpeciesCount != null && row.estimatedDescribed > 0
                                ? renderBar((row.gbifNeSpeciesCount / row.estimatedDescribed) * 100, "#3b82f6", false, row.gbifNeSpeciesCount)
                                : <span className="text-sm text-zinc-400">—</span>}
                            </td>
                          )}
                          {colNeCell(row.colNe, row.estimatedDescribed)}
                          {isVisible("totalGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.totalGbifObservations != null ? row.totalGbifObservations.toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("gbifDistribution") && (
                            <td className={flexTdClasses}><span className="text-sm text-zinc-400">—</span></td>
                          )}
                          {isVisible("meanGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.meanGbifObsPerSpecies != null ? Math.round(row.meanGbifObsPerSpecies).toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("medianGbifObs") && (
                            <td className={numericTdClasses}>
                              <span className="text-sm md:text-base text-zinc-700 dark:text-zinc-300 tabular-nums">
                                {row.medianGbifObsPerSpecies != null ? row.medianGbifObsPerSpecies.toLocaleString() : "—"}
                              </span>
                            </td>
                          )}
                          {isVisible("breakdown") && (
                            <td className={flexTdClasses}>
                              {renderBreakdownBar(row.byCategory || {})}
                            </td>
                          )}
                        </tr>
                        );
                        return (
                          <>
                            {visibleNamedRows.map(renderGroupRow)}
                            {isSscSection && hiddenCount > 0 && (
                              <tr
                                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                                onClick={() => toggleSscSection(section.title)}
                              >
                                <td colSpan={visibleColCount} className={`${cellPad} text-center`}>
                                  <span className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">
                                    Show all {namedRows.length} groups ({hiddenCount} more)
                                  </span>
                                </td>
                              </tr>
                            )}
                            {isSscSection && isExpanded && namedRows.length > SSC_SECTION_COLLAPSE_SIZE && (
                              <tr
                                className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer"
                                onClick={() => toggleSscSection(section.title)}
                              >
                                <td colSpan={visibleColCount} className={`${cellPad} text-center`}>
                                  <span className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors">Show less</span>
                                </td>
                              </tr>
                            )}
                            {catchAllRow && renderGroupRow(catchAllRow)}
                          </>
                        );
                      })()}
                      {/* Gap between sections */}
                      {si < flatData.length - 1 && (
                        <tr><td colSpan={visibleColCount} className="p-0"><div className="h-1" /></td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {/* Grand TOTAL row */}
                {renderRow(
                  "total",
                  "TOTAL",
                  "#22c55e",
                  totalDescribed,
                  totalAssessed,
                  totalPercentAssessed,
                  totalOutdated,
                  totalPercentOutdated,
                  totalByCategory,
                  false,
                  true,
                  true,
                  { total: totalGbifObs, mean: totalMeanGbifObs, speciesCount: totalGbifSpecies, gbifNeCount: totalGbifNeSpecies, colDescribed: totalColDescribed, colNe: totalColNe }
                )}
              </>
            ) : null
          ) : (
            <>
              {/* All Species totals row (always visible) */}
              {renderRow(
                "all",
                "All Species",
                "#22c55e",
                totalDescribed,
                totalAssessed,
                totalPercentAssessed,
                totalOutdated,
                totalPercentOutdated,
                totalByCategory,
                false,
                true,
                true,
                { total: totalGbifObs, mean: totalMeanGbifObs, speciesCount: totalGbifSpecies, gbifNeCount: totalGbifNeSpecies, colDescribed: totalColDescribed, colNe: totalColNe }
              )}

              {/* Separator - hide when only "All Species" is selected */}
              {!selectedTaxa.has("all") && (
                <tr>
                  <td colSpan={visibleColCount} className="p-0">
                    <div className="border-b-2 border-zinc-200 dark:border-zinc-700" />
                  </td>
                </tr>
              )}

              {/* Per-taxon rows with expandable subgroups */}
              {selectedTaxa.has("all")
                ? null
                : selectedSubgroups.size > 0 && selectedTaxa.size > 0 && !taxaExpanded
                  ? /* When subgroups are selected, show ancestor breadcrumbs + selected subgroup */
                    (() => {
                      const rows: React.ReactNode[] = [];
                      for (const sgId of selectedSubgroups) {
                        const parentTaxon = perTaxa.find(t => selectedTaxa.has(t.id));
                        if (!parentTaxon) continue;

                        // Render ancestor context rows (view root → intermediate ancestors)
                        // getAncestors returns [immediate parent, ..., root] so we reverse and
                        // skip ancestors at or above the view root (which is in selectedTaxa)
                        const ancestors = getAncestors(sgId);
                        const intermediateAncestorIds: string[] = [];
                        for (const aId of ancestors) {
                          if (selectedTaxa.has(aId)) break; // Stop at view root
                          // SSC wrapper nodes (SSC groups mode) are display-only, kept
                          // outside the real tree so they don't show up as a breadcrumb —
                          // their children navigate as if parented by their real taxon
                          // (mammals, reptiles, ...) instead — see SSC_SECTIONS.
                          if (SSC_SECTIONS.some((s) => s.nodeId === aId)) break;
                          intermediateAncestorIds.push(aId);
                        }

                        // View root data from perTaxa
                        const viewRootSummary: SubGroupSummary = {
                          id: parentTaxon.id, name: parentTaxon.name,
                          estimatedDescribed: parentTaxon.estimatedDescribed,
                          totalAssessed: parentTaxon.totalAssessed, outdated: parentTaxon.outdated,
                          gbifNeSpeciesCount: parentTaxon.gbifNeSpeciesCount ?? 0,
                          byCategory: parentTaxon.byCategory,
                          colDescribed: parentTaxon.colDescribed, colNe: parentTaxon.colNe,
                        };
                        rows.push(renderAncestorRow(viewRootSummary, parentTaxon.color, 0, parentTaxon.id, true));

                        // Intermediate ancestors from subgroupData
                        intermediateAncestorIds.reverse().forEach((aId, i) => {
                          let ancestorData: SubGroupSummary | undefined;
                          for (const subs of Object.values(subgroupData)) {
                            ancestorData = subs.find(s => s.id === aId);
                            if (ancestorData) break;
                          }
                          if (!ancestorData) {
                            const node = findNode(aId);
                            if (!node) return;
                            ancestorData = { id: node.id, name: node.name, estimatedDescribed: node.estimatedDescribed ?? 0,
                                             totalAssessed: 0, outdated: 0, gbifNeSpeciesCount: 0, byCategory: {} };
                          }
                          rows.push(renderAncestorRow(ancestorData, parentTaxon.color, i + 1, parentTaxon.id, false));
                        });

                        // Search ALL fetched subgroup data for this node (any depth)
                        let sgData: SubGroupSummary | undefined;
                        for (const subs of Object.values(subgroupData)) {
                          sgData = subs.find(s => s.id === sgId);
                          if (sgData) break;
                        }
                        // Fallback: construct from taxonomy node while data loads
                        if (!sgData) {
                          const node = findNode(sgId);
                          if (!node) continue;
                          sgData = { id: node.id, name: node.name, estimatedDescribed: node.estimatedDescribed ?? 0,
                                     totalAssessed: 0, outdated: 0, gbifNeSpeciesCount: 0, byCategory: {} };
                        }

                        rows.push(renderCollapsedSubgroupRow(parentTaxon, sgData));
                        // Render children if expanded
                        const sgChildren = subgroupData[sgId] ?? [];
                        if (expandedTaxa.has(sgId)) {
                          rows.push(...sgChildren.map(child =>
                            renderSubgroupRow(child, parentTaxon.color, 1, parentTaxon.id)));
                        }
                      }
                      return rows;
                    })()
                  : (selectedTaxa.size > 0 && !taxaExpanded
                    ? perTaxa
                        .filter((taxon) => selectedTaxa.has(taxon.id))
                        .map((taxon) => renderTaxonWithSubgroups(taxon, true))
                    : perTaxa.map((taxon) =>
                        renderTaxonWithSubgroups(taxon, selectedTaxa.has(taxon.id))
                      )
                  )
              }
            </>
          )}
        </tbody>
      </table>
    </div>
    {/* Subtle controls: usage hint + # Described toggle + expand/table controls,
        all landing-only — hidden once a taxon is selected. */}
    {!loading && perTaxa.length > 0 && selectedTaxa.size === 0 && (
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 mt-1.5">
        {/* Usage hint — desktop only; the toggles below matter more on mobile than this prose */}
        <span className="hidden sm:inline pl-3 md:pl-4 text-xs text-zinc-400 dark:text-zinc-500">
          Click to filter, Cmd/Ctrl+click to multi-select.
        </span>
        <div className="flex flex-wrap items-center gap-3 pl-3 sm:pl-0">
          {/* IUCN ↔ CoL source toggle: flips the described count + recomputes % Assessed */}
          <span className="inline-flex items-center gap-1.5">
            <span className="text-xs text-zinc-400 dark:text-zinc-500">Source for # Described:</span>
            <span className="inline-flex rounded-md overflow-hidden border border-zinc-300 dark:border-zinc-600 text-[10px] font-semibold" title="Switch # Described Species between IUCN Table 1a estimates and the Catalogue of Life backbone, for the rows with an official IUCN figure — every other row (sub-groups, SSC groups) always shows the CoL-derived count">
              {(["iucn", "col"] as const).map((src) => (
                <button
                  key={src}
                  onClick={(e) => { e.stopPropagation(); setDescribedSource(src); }}
                  className={`px-1.5 py-0.5 transition-colors ${
                    describedSource === src
                      ? "bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900"
                      : "text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  }`}
                >
                  {src === "iucn" ? "IUCN" : "CoL"}
                </button>
              ))}
            </span>
          </span>
          <span className="text-zinc-300 dark:text-zinc-700">|</span>
          {table1aMode ? (
            <button
              onClick={() => onLayoutModeChange(null)}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              Exit Table 1a View
            </button>
          ) : sscMode ? (
            <button
              onClick={() => onLayoutModeChange(null)}
              className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            >
              Exit SSC Groups View
            </button>
          ) : (
            <>
              <button
                onClick={allExpanded ? collapseAll : expandAll}
                className="inline-flex items-center gap-1 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                {allExpanded ? <FaCompressAlt size={9} /> : <FaExpandAlt size={9} />}
                {allExpanded ? "Collapse all" : "Expand all"}
              </button>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => onLayoutModeChange("table1a")}
                  className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  Table 1a View
                </button>
                <span className="relative group/t1a">
                  <a
                    href={IUCN_SOURCE_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FaInfoCircle size={10} />
                  </a>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/t1a:opacity-100 group-hover/t1a:visible z-50 shadow-lg pointer-events-none">
                    View IUCN Red List Table 1a (PDF)
                  </span>
                </span>
              </span>
              <span className="text-zinc-300 dark:text-zinc-700">|</span>
              <span className="inline-flex items-center gap-1">
                <button
                  onClick={() => onLayoutModeChange("ssc")}
                  className="text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                >
                  SSC Groups View
                </button>
                <span className="relative group/ssc">
                  <a
                    href="https://iucn.org/our-union/commissions/group/1445"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <FaInfoCircle size={10} />
                  </a>
                  <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-zinc-800 dark:bg-zinc-700 rounded whitespace-nowrap opacity-0 invisible group-hover/ssc:opacity-100 group-hover/ssc:visible z-50 shadow-lg pointer-events-none">
                    View IUCN SSC Specialist Groups (mammals, reptiles, fishes, invertebrates, plants & fungi)
                  </span>
                </span>
              </span>
            </>
          )}
        </div>
      </div>
    )}
    </>
  );
}
