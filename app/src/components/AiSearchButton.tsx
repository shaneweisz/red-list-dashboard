"use client";

import { useState, useRef, useEffect } from "react";

export function AiSearchButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) {
      // Small delay to let the panel render
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setError(null);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        setError(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: query.trim() }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const { queryString } = await res.json();

      // Navigate to the generated URL
      window.history.pushState(null, "", "/" + queryString);
      window.dispatchEvent(new PopStateEvent("popstate"));

      setQuery("");
      setIsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Magic wand toggle button */}
      <button
        onClick={() => {
          setIsOpen(!isOpen);
          setError(null);
        }}
        title="AI Search — describe what you're looking for"
        className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
          isOpen
            ? "border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-500 dark:hover:text-violet-400"
        }`}
      >
        {/* Sparkles / magic wand icon */}
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
          />
        </svg>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-80 sm:w-96 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-xl">
          <div className="px-3 pt-3 pb-2">
            <p className="text-xs font-medium text-violet-600 dark:text-violet-400 mb-1.5">
              AI Search
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              Describe what you&apos;re looking for in plain English.
            </p>
            <form onSubmit={handleSubmit} className="flex gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "threatened frogs in South America"'
                disabled={loading}
                className="flex-1 min-w-0 px-3 py-1.5 text-sm rounded-md border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-400 dark:focus:ring-violet-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="shrink-0 px-3 py-1.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-700 disabled:bg-violet-400 dark:bg-violet-500 dark:hover:bg-violet-600 dark:disabled:bg-violet-700 text-white transition-colors disabled:cursor-not-allowed"
              >
                {loading ? (
                  <div className="h-4 w-4 rounded-full animate-spin border-2 border-white/30 border-t-white" />
                ) : (
                  "Go"
                )}
              </button>
            </form>
            {error && (
              <p className="mt-2 text-xs text-red-600 dark:text-red-400">
                {error}
              </p>
            )}
            <div className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
              Try: &ldquo;plant assessments by Steve Bachman&rdquo;, &ldquo;a random bird from South Africa&rdquo;, &ldquo;outdated moth with many new GBIF observations&rdquo;
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
