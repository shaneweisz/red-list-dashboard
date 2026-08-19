"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { FaGlobeAmericas, FaArrowLeft } from "react-icons/fa";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useBrand } from "@/components/BrandProvider";
import { parseParams, type ViewMode } from "@/hooks/useFilterParams";
import { prettifyQs } from "@/lib/query-string";
import { SpeciesCacheProvider } from "@/contexts/SpeciesCacheContext";

const RedListView = dynamic(
  () => import("@/components/redlist/RedListView"),
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

// Mirrors page.tsx's own view-mode <-> URL sync (RedListPage's `viewMode`
// state + handleViewModeChange), namespaced to one compare panel's suffixed
// `view`/`view_b` param instead of the single dashboard's bare `view`.
function usePanelViewMode(paramSuffix: string) {
  const [viewMode, setViewMode] = useState<ViewMode>("reassessments");

  useEffect(() => {
    const syncFromUrl = () => {
      setViewMode(parseParams(window.location.search, paramSuffix).viewMode);
    };
    syncFromUrl();
    window.addEventListener("popstate", syncFromUrl);
    return () => window.removeEventListener("popstate", syncFromUrl);
  }, [paramSuffix]);

  const handleViewModeChange = (mode: ViewMode) => {
    if (viewMode === mode) return;
    setViewMode(mode);
    // Preserve every other param (including the other panel's suffixed ones)
    // across the switch — only this panel's `view`/`view_b` key changes.
    const params = new URLSearchParams(window.location.search);
    const key = `view${paramSuffix}`;
    if (mode === "reassessments") params.delete(key);
    else params.set(key, "new-assessments");
    const qs = prettifyQs(params.toString());
    window.history.pushState(null, "", qs ? `/compare?${qs}` : "/compare");
    window.dispatchEvent(new PopStateEvent("popstate"));
  };

  return { viewMode, handleViewModeChange };
}

// One dashboard panel — same RedListView the single-dashboard page renders,
// just namespaced to its own slice of the URL via paramSuffix (see
// useFilterParams.ts) so panel B's filters live at `taxa_b=`/`categories_b=`
// etc. without touching panel A's bare `taxa=`/`categories=`.
function ComparePanel({ paramSuffix }: { paramSuffix: string }) {
  const { viewMode, handleViewModeChange } = usePanelViewMode(paramSuffix);
  // Same "remember taxa across the Assessed/Not Evaluated toggle" pattern
  // page.tsx uses for the single dashboard, kept independent per panel.
  const [sharedTaxa, setSharedTaxa] = useState<Set<string>>(new Set());
  const [sharedSubgroups, setSharedSubgroups] = useState<Set<string>>(new Set());

  return (
    <RedListView
      paramSuffix={paramSuffix}
      viewMode={viewMode}
      onViewModeChange={handleViewModeChange}
      sharedTaxa={sharedTaxa}
      sharedSubgroups={sharedSubgroups}
      onTaxaChange={setSharedTaxa}
      onSubgroupsChange={setSharedSubgroups}
    />
  );
}

export default function ComparePage() {
  const brand = useBrand();

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 px-4 sm:px-6 py-4 md:px-10 md:py-8">
      <main className="max-w-[110rem] w-full min-w-0 mx-auto flex-1">
        <div className="mb-4 md:mb-6 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity"
            title="Back to dashboard"
          >
            {brand.showGlobe && (
              <FaGlobeAmericas className="shrink-0 text-2xl text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            )}
            <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 dark:text-zinc-100 truncate">
              {brand.title} <span className="text-zinc-400 dark:text-zinc-500 font-normal">— Compare</span>
            </h1>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            >
              <FaArrowLeft aria-hidden="true" />
              Dashboard
            </Link>
            <ThemeToggle />
          </div>
        </div>

        {/* One shared cache above both panels — picking the same taxon on both
            sides only fetches it once (see SpeciesCacheContext). */}
        <SpeciesCacheProvider>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-0 items-start">
            <div className="min-w-0 lg:pr-6">
              <ComparePanel paramSuffix="" />
            </div>
            <div className="min-w-0 lg:pl-6 lg:border-l lg:border-zinc-200 lg:dark:border-zinc-800">
              <ComparePanel paramSuffix="_b" />
            </div>
          </div>
        </SpeciesCacheProvider>
      </main>
    </div>
  );
}
