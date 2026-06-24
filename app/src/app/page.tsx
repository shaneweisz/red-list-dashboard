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

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 px-4 sm:px-6 py-4 md:px-16 md:py-8">
      <main className="max-w-5xl w-full min-w-0 mx-auto flex-1">
        {/* Header: two aligned rows (title | view-toggle, subtitle | search).
            Globe sits inline with the title so the subtitle, controls and
            search bar share the same flush-left edge as the table below. */}
        <div className="mb-[0.9rem] md:mb-[1.35rem]">
          <div className="min-w-0 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center gap-x-3 gap-y-1.5 sm:gap-y-3 [grid-template-areas:'title'_'subtitle'_'controls'_'search'] sm:[grid-template-areas:'title_controls'_'subtitle_search']">
            <div className="[grid-area:title] flex items-center gap-2 min-w-0">
              {brand.showGlobe && (
                <FaGlobeAmericas className="shrink-0 text-2xl sm:text-3xl md:text-[2rem] text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              )}
              <h1 className="text-2xl sm:text-3xl md:text-[2rem] font-bold text-zinc-900 dark:text-zinc-100 truncate">{brand.title}</h1>
            </div>
            {brand.subtitle && (
              <p className="[grid-area:subtitle] text-base md:text-[1.375rem] text-zinc-500 dark:text-zinc-400">{brand.subtitle}</p>
            )}
            <div className="[grid-area:controls] flex items-center gap-2 sm:justify-self-end">
              {/* View mode toggle */}
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-sm">
                <button
                  onClick={() => {
                    if (viewMode === "reassessments") return;
                    setViewMode("reassessments");
                    setSharedTaxa(new Set());
                    setSharedSubgroups(new Set());
                    window.history.pushState(null, "", "/");
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                  className={`px-3 py-2 sm:py-1.5 font-medium transition-colors ${
                    viewMode === "reassessments"
                      ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  }`}
                >
                  {brand.assessedTabLabel ?? "Reassessments"}
                </button>
                <button
                  onClick={() => {
                    if (viewMode === "new-assessments") return;
                    setViewMode("new-assessments");
                    setSharedTaxa(new Set());
                    setSharedSubgroups(new Set());
                    window.history.pushState(null, "", "/?view=new-assessments");
                    window.dispatchEvent(new PopStateEvent("popstate"));
                  }}
                  className={`px-3 py-2 sm:py-1.5 font-medium transition-colors ${
                    viewMode === "new-assessments"
                      ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  }`}
                >
                  {brand.unassessedTabLabel ?? "New Assessments"}
                </button>
              </div>
              <ThemeToggle />
            </div>
            <div className="[grid-area:search] sm:justify-self-end">
              <SpeciesSearchBar />
            </div>
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
          {" "}at the University of Cambridge. The data is sourced from publicly available{" "}
          <a
            href="https://www.iucnredlist.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            IUCN Red List
          </a>
          ,{" "}
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
          {" "}and{" "}
          <a
            href="https://eol.org"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            Encyclopedia of Life
          </a>
          {" "}data. Any errors in aggregation or presentation are my own. Please verify against the primary sources before use, and do get in touch if you notice any issues.
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
