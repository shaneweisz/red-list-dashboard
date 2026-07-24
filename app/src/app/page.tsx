"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FaGlobeAmericas } from "react-icons/fa";
import { SpeciesSearchBar } from "../components/SpeciesSearchBar";
import { ThemeToggle } from "../components/ThemeToggle";
import { useBrand } from "../components/BrandProvider";
import { parseParams, type ViewMode } from "../hooks/useFilterParams";

// Dynamically import view component
const RedListView = dynamic(
  () => import("../components/redlist/RedListView"),
  {
    loading: () => (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-10 w-10 border-4 border-zinc-400 border-t-transparent rounded-full" />
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          Loading view...
        </p>
      </div>
    ),
  }
);

export default function RedListPage() {
  const brand = useBrand();
  const [viewMode, setViewMode] = useState<ViewMode>("reassessments");

  // Hydrate viewMode from URL on mount + sync on popstate (back/forward)
  useEffect(() => {
    const syncFromUrl = () => {
      const parsed = parseParams(window.location.search);
      setViewMode(parsed.viewMode);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, []);

  // Shared taxa/subgroup state that persists across view switches
  const [sharedTaxa, setSharedTaxa] = useState<Set<string>>(new Set());
  const [sharedSubgroups, setSharedSubgroups] = useState<Set<string>>(new Set());

  // Portal target for TaxaSummary's View-by selector (Standard/Table 1a/SSC/
  // Country) — a callback ref so it's available as soon as the header div
  // mounts. Keeping the selector's own state inside TaxaSummary (URL-synced
  // via useFilterParams) and just portaling its markup up here means it's
  // reachable from the persistent top row at any drill-down depth, without
  // lifting that state out of RedListView.
  const [viewSelectorSlotEl, setViewSelectorSlotEl] = useState<HTMLDivElement | null>(null);

  // View-mode switch — previously two header buttons here, now surfaced
  // instead by RedListView itself (next to its own Assessed/Not Evaluated
  // stat card, where the mode actually matters), via this callback.
  const handleViewModeChange = (mode: ViewMode) => {
    if (viewMode === mode) return;
    setViewMode(mode);
    // Preserve the current taxa/subgroup/layout selection (and any other
    // URL-only filters) across the switch — only the `view` param changes.
    const params = new URLSearchParams(window.location.search);
    if (mode === "reassessments") params.delete("view");
    else params.set("view", "new-assessments");
    const qs = params.toString();
    window.history.pushState(null, "", qs ? `/?${qs}` : "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 px-4 sm:px-6 py-4 md:px-16 md:py-8">
      <main className="max-w-5xl w-full min-w-0 mx-auto flex-1">
        {/* Header: two aligned rows (title | search, subtitle | view + theme).
            Globe sits inline with the title so the subtitle, controls and
            search bar share the same flush-left edge as the table below. */}
        <div className="mb-[0.9rem] md:mb-[1.35rem]">
          <div className="min-w-0 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-x-3 gap-y-1.5 sm:gap-y-3 [grid-template-areas:'title'_'subtitle'_'search'_'view'] sm:[grid-template-areas:'title_search'_'subtitle_view']">
            <button
              type="button"
              onClick={() => {
                // "Go home": drop every filter/selection AND reset back to the
                // default Assessed view (dropping any New Assessments choice),
                // but keep the layout (Standard/Table 1a/SSC/Country) choice —
                // same fields clearAllFiltersAndTaxa preserves minus `view`,
                // replicated here via raw URL params since this click lives
                // outside RedListView's useFilterParams instance. Falls back to
                // `origin` when `layout` itself is absent — a taxon drill-down
                // out of Country View clears `layout` but leaves
                // `origin=country` behind (see useFilterParams.ts's
                // originLayout), so Home still lands back on that view instead
                // of the generic default.
                const params = new URLSearchParams(window.location.search);
                const kept = new URLSearchParams();
                const layout = params.get("layout") || params.get("origin");
                if (layout) kept.set("layout", layout);
                const qs = kept.toString();
                window.history.pushState(null, "", qs ? `/?${qs}` : "/");
                window.dispatchEvent(new PopStateEvent("popstate"));
              }}
              className="[grid-area:title] flex items-center gap-2 min-w-0 text-left cursor-pointer hover:opacity-80 transition-opacity"
              title="Back to home"
            >
              {brand.showGlobe && (
                <FaGlobeAmericas className="shrink-0 text-2xl sm:text-3xl md:text-[2rem] text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              )}
              <h1 className="text-2xl sm:text-3xl md:text-[2rem] font-bold text-zinc-900 dark:text-zinc-100 truncate">{brand.title}</h1>
            </button>
            {brand.subtitle && (
              <p className="[grid-area:subtitle] text-[15px] md:text-[1.375rem] text-zinc-500 dark:text-zinc-400">{brand.subtitle}</p>
            )}
            <div className="[grid-area:search] flex items-center gap-2 sm:justify-self-end">
              <SpeciesSearchBar />
              <ThemeToggle />
            </div>
            <div className="[grid-area:view] flex items-center gap-2 flex-wrap sm:justify-self-end">
              <div ref={setViewSelectorSlotEl} className="flex items-center" />
            </div>
          </div>
        </div>

        {/* Content — single component instance stays mounted on viewMode switch */}
        <RedListView
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          sharedTaxa={sharedTaxa}
          sharedSubgroups={sharedSubgroups}
          onTaxaChange={setSharedTaxa}
          onSubgroupsChange={setSharedSubgroups}
          viewSelectorSlotEl={viewSelectorSlotEl}
        />
      </main>

      <footer className="max-w-xl mx-auto mt-2 pb-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500">
          Questions or feedback? Contact{" "}
          <a
            href="https://www.shaneweisz.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Shane
          </a>
          {" "}at{" "}
          <a
            href="mailto:sw984@cam.ac.uk"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            sw984@cam.ac.uk
          </a>
          .
        </p>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-3">
          This dashboard is part of a{" "}
          <a
            href="https://anil.recoil.org/ideas/living-iucn-redlist"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            PhD research project
          </a>
          {" "}at the University of Cambridge. The data is sourced from{" "}
          <a
            href="https://www.iucnredlist.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            IUCN Red List
          </a>
          {" "}(version 2026-1),{" "}
          <a
            href="https://www.gbif.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            GBIF
          </a>
          ,{" "}
          <a
            href="https://www.inaturalist.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            iNaturalist
          </a>
          ,{" "}
          <a
            href="https://openalex.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            OpenAlex
          </a>
          ,{" "}
          <a
            href="https://cites.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            CITES
          </a>
          ,{" "}
          <a
            href="https://speciesplus.net"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Species+
          </a>
          ,{" "}
          <a
            href="https://www.catalogueoflife.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Catalogue of Life
          </a>
          , and{" "}
          <a
            href="https://eol.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Encyclopedia of Life
          </a>
          {" "}data. This is a free, non-commercial research tool; commercial users should obtain IUCN Red List data via{" "}
          <a
            href="https://www.ibat-alliance.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            IBAT
          </a>
          . Any errors in aggregation or presentation are my own. Please verify against the primary sources before use, and do get in touch if you notice any issues.
        </p>
        <p className="text-center text-xs text-zinc-400 dark:text-zinc-500 mt-4">
          <Link
            href="/privacy"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Privacy policy
          </Link>
        </p>
      </footer>
    </div>
  );
}
