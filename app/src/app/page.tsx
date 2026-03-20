"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { ThemeToggle } from "../components/ThemeToggle";

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

type ViewMode = "reassessments" | "new-assessments";

export default function RedListPage() {
  const [viewMode, setViewMode] = useState<ViewMode>("reassessments");

  // Shared taxa/subgroup state that persists across view switches
  const [sharedTaxa, setSharedTaxa] = useState<Set<string>>(new Set());
  const [sharedSubgroups, setSharedSubgroups] = useState<Set<string>>(new Set());

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-6 py-4 md:px-16 md:py-8">
      <main className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-1 md:mb-2">
              IUCN Red List Assessments Dashboard
            </h1>
            <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400">
              Click taxa rows to filter, use charts and search to explore species. Cmd/Ctrl+click to multiselect.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-sm">
              <button
                onClick={() => setViewMode("reassessments")}
                className={`px-3 py-1.5 font-medium transition-colors ${
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
                className={`px-3 py-1.5 font-medium transition-colors ${
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

      <footer className="max-w-6xl mx-auto mt-6 pb-6 pt-4 border-t border-zinc-200 dark:border-zinc-800">
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
          Part of a{" "}
          <a
            href="https://anil.recoil.org/ideas/living-iucn-redlist"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            PhD research project
          </a>
          {" "}at the University of Cambridge.
          Based on public IUCN Red List and GBIF data. Verify against primary sources before citing.
        </p>
      </footer>
    </div>
  );
}
