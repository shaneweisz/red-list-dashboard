"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { PanelState } from "@/components/compare/ComparePanel";

// Client-only: each panel fetches its own data; filter state is owned here.
const ComparePanel = dynamic(() => import("@/components/compare/ComparePanel"), {
  ssr: false,
  loading: () => (
    <div className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 min-h-[400px] animate-pulse" />
  ),
});

// ── URL serialization ────────────────────────────────────────────────────────
// Each side gets prefixed params so a comparison is fully shareable, e.g.
//   /compare?a=birds&b=amphibians&aCat=CR,EN&bTrend=Decreasing
function emptyState(taxon: string): PanelState {
  return { taxonId: taxon, selectedCategories: new Set(), selectedTrends: new Set(), search: "" };
}

function parseSide(p: URLSearchParams, prefix: "a" | "b", fallbackTaxon: string): PanelState {
  const set = (key: string) => {
    const raw = p.get(prefix + key);
    return raw ? new Set(raw.split(",").filter(Boolean)) : new Set<string>();
  };
  return {
    taxonId: p.get(prefix) || fallbackTaxon,
    selectedCategories: set("Cat"),
    selectedTrends: set("Trend"),
    search: p.get(prefix + "Q") || "",
  };
}

function buildUrl(a: PanelState, b: PanelState): string {
  const p = new URLSearchParams();
  const write = (prefix: "a" | "b", s: PanelState) => {
    p.set(prefix, s.taxonId);
    if (s.selectedCategories.size > 0) p.set(prefix + "Cat", [...s.selectedCategories].join(","));
    if (s.selectedTrends.size > 0) p.set(prefix + "Trend", [...s.selectedTrends].join(","));
    if (s.search.trim()) p.set(prefix + "Q", s.search.trim());
  };
  write("a", a);
  write("b", b);
  return `?${p.toString()}`;
}

export default function ComparePage() {
  const [sideA, setSideA] = useState<PanelState>(() => emptyState("birds"));
  const [sideB, setSideB] = useState<PanelState>(() => emptyState("amphibians"));
  const [copied, setCopied] = useState(false);

  // Hydrate from URL on mount + sync on back/forward.
  useEffect(() => {
    const sync = () => {
      const p = new URLSearchParams(window.location.search);
      setSideA(parseSide(p, "a", "birds"));
      setSideB(parseSide(p, "b", "amphibians"));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  // Keep the URL in sync so a copy/paste of the address bar reproduces the view.
  useEffect(() => {
    const url = window.location.pathname + buildUrl(sideA, sideB);
    window.history.replaceState(null, "", url);
  }, [sideA, sideB]);

  const patchA = useCallback((patch: Partial<PanelState>) => setSideA((s) => ({ ...s, ...patch })), []);
  const patchB = useCallback((patch: Partial<PanelState>) => setSideB((s) => ({ ...s, ...patch })), []);

  const copyLink = async () => {
    const url = window.location.origin + window.location.pathname + buildUrl(sideA, sideB);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — select-and-copy fallback.
      window.prompt("Copy this link:", url);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 px-4 sm:px-6 py-4 md:px-12 md:py-8">
      <main className="max-w-6xl w-full mx-auto flex-1">
        <div className="mb-3 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
              Compare Taxa
              <span className="ml-2 align-middle text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                POC
              </span>
            </h1>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              Pick a taxon on each side and apply filters independently. The URL updates as you go — share it to reproduce the exact comparison.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={copyLink}
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <Link
              href="/"
              className="px-3 py-1.5 text-sm font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              ← Dashboard
            </Link>
            <ThemeToggle />
          </div>
        </div>

        {/* Split screen: side-by-side on desktop, stacked on mobile */}
        <div className="flex flex-col lg:flex-row gap-4">
          <ComparePanel side="A" state={sideA} onChange={patchA} />
          <ComparePanel side="B" state={sideB} onChange={patchB} />
        </div>
      </main>
    </div>
  );
}
