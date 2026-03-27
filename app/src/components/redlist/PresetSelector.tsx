"use client";

import { useState, useRef, useEffect } from "react";
import { TAXONOMY_VIEWS, PRESET_ORDER, type PresetFilters } from "@/config/taxonomy-views";

interface PresetSelectorProps {
  activePreset: string;
  onSelect: (presetId: string, filters?: PresetFilters) => void;
}

export default function PresetSelector({ activePreset, onSelect }: PresetSelectorProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const activeView = TAXONOMY_VIEWS[activePreset] ?? TAXONOMY_VIEWS.default;
  const label = activePreset === "default" ? "Group view" : activeView.name;

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-sm font-medium rounded-lg border transition-colors ${
          activePreset !== "default"
            ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900 border-zinc-800 dark:border-zinc-100"
            : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-700"
        }`}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        {label}
        <svg
          className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg z-50 py-1 overflow-hidden">
          {/* Default option */}
          <button
            onClick={() => { onSelect("default"); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              activePreset === "default"
                ? "bg-zinc-100 dark:bg-zinc-700 font-medium text-zinc-900 dark:text-zinc-100"
                : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
            }`}
          >
            <div className="font-medium">Default</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">8 major taxonomic groups</div>
          </button>

          <div className="border-t border-zinc-100 dark:border-zinc-700 my-1" />

          {PRESET_ORDER.map(id => {
            const view = TAXONOMY_VIEWS[id];
            return (
              <button
                key={id}
                onClick={() => { onSelect(id, view.defaultFilters); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  activePreset === id
                    ? "bg-zinc-100 dark:bg-zinc-700 font-medium text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50"
                }`}
              >
                <div className="font-medium">{view.name}</div>
                {view.description && (
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{view.description}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
