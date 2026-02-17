"use client";

import dynamic from "next/dynamic";
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
              Click taxa rows to filter, use charts and search to explore species
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
          </div>
        </div>

        {/* Red List Content */}
        <RedListView />

        {/* Footer attribution — required by IUCN Red List Terms of Use */}
        <footer className="mt-8 pt-4 border-t border-zinc-200 dark:border-zinc-800 text-[11px] text-zinc-400 dark:text-zinc-500 space-y-1">
          <p>
            IUCN ({new Date().getFullYear()}).{" "}
            <em>The IUCN Red List of Threatened Species.</em> Version 2025-2.{" "}
            <a
              href="https://www.iucnredlist.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              https://www.iucnredlist.org
            </a>
            . Accessed on{" "}
            {new Date().toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            .
          </p>
          <p>
            Subject to IUCN Red List{" "}
            <a
              href="https://www.iucnredlist.org/terms/terms-of-use"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              Terms of Use
            </a>
            . Occurrence data from{" "}
            <a
              href="https://www.gbif.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              GBIF.org
            </a>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
