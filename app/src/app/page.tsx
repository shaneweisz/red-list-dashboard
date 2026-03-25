"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { ThemeToggle } from "../components/ThemeToggle";
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

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 px-4 sm:px-6 py-4 md:px-16 md:py-8">
      <main className="max-w-6xl w-full min-w-0 mx-auto flex-1">
        {/* Header */}
        <div className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-1 md:mb-2">
              IUCN Red List Assessments Dashboard
            </h1>
            <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400">
              Click taxa rows to filter, use charts and search to explore species.<span className="hidden sm:inline"> Cmd/Ctrl+click to multiselect.</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-sm">
              <button
                onClick={() => setViewMode("reassessments")}
                className={`px-3 py-2 sm:py-1.5 font-medium transition-colors ${
                  viewMode === "reassessments"
                    ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                }`}
              >
                Reassessments
              </button>
              <button
                onClick={() => {
                  // Clear "all" selection — NE species must be loaded per-taxon
                  if (sharedTaxa.has("all")) setSharedTaxa(new Set());
                  setViewMode("new-assessments");
                }}
                className={`px-3 py-2 sm:py-1.5 font-medium transition-colors ${
                  viewMode === "new-assessments"
                    ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                    : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                }`}
              >
                New Assessments
              </button>
            </div>
            <ThemeToggle />
          </div>
        </div>

        {/* Content — single component instance stays mounted on viewMode switch */}
        <RedListView
          viewMode={viewMode}
          sharedTaxa={sharedTaxa}
          sharedSubgroups={sharedSubgroups}
          onTaxaChange={setSharedTaxa}
          onSubgroupsChange={setSharedSubgroups}
        />
      </main>

      <footer className="max-w-xl mx-auto mt-5 pb-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
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
          {" "}at the University of Cambridge. The data is sourced from publicly available{" "}
          <a
            href="https://www.iucnredlist.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            IUCN Red List
          </a>
          {" "}and{" "}
          <a
            href="https://www.gbif.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            GBIF
          </a>
          {" "}data. Any errors in aggregation or presentation are my own. Please verify against the primary sources before use, and do get in touch if you notice any issues.
        </p>
      </footer>
    </div>
  );
}
