"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ThemeToggle } from "../components/ThemeToggle";

// Dynamically import RedListView component
const RedListView = dynamic(
  () => import("../components/redlist/RedListView"),
  {
    loading: () => (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="animate-spin h-10 w-10 border-4 border-red-600 border-t-transparent rounded-full" />
        <p className="mt-4 text-zinc-500 dark:text-zinc-400">
          Loading Red List view...
        </p>
      </div>
    ),
  }
);

export default function RedListPage() {
  const [selectedTaxonName, setSelectedTaxonName] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8">
      <main className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-4 md:mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-1 md:mb-2">
              IUCN Red List Assessments Dashboard
            </h1>
            <p className="text-sm md:text-base text-zinc-600 dark:text-zinc-400">
              Click a taxon row for details, click again to return
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Tab Navigation */}
            <div className="flex gap-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg p-1">
              <div className="px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 shadow-sm">
                Red List
              </div>
              <Link
                href="/gbif"
                className="px-3 md:px-4 py-1.5 rounded-md text-xs md:text-sm font-medium transition-colors text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200"
              >
                GBIF
              </Link>
            </div>
            <ThemeToggle />
          </div>
        </div>

        {/* Red List Content */}
        <RedListView onTaxonChange={setSelectedTaxonName} />
      </main>
    </div>
  );
}
