"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface ReasoningStep {
  type: "thinking" | "reasoning" | "tool_call" | "tool_result";
  text: string;
}

const MODELS = [
  { id: "gemini-3.1-flash-lite-preview", label: "3.1 Flash Lite" },
  { id: "gemini-2.5-flash", label: "2.5 Flash" },
  { id: "gemini-2.5-pro", label: "2.5 Pro" },
];

const EXAMPLE_CATEGORIES = [
  {
    label: "Reassessment triage",
    examples: [
      "outdated mammals with many new GBIF observations",
      "species overdue for reassessment with declining populations",
      "old assessments with 10K+ new observations, sorted by % new",
    ],
  },
  {
    label: "Data gaps",
    examples: [
      "data deficient freshwater fish in Southeast Asia",
      "DD species that now have over 1000 GBIF observations",
      "species with no GBIF observations at all",
    ],
  },
  {
    label: "Threats & conservation",
    examples: [
      "species threatened by agriculture in the Amazon",
      "coral species affected by climate change",
      "mammals threatened by hunting in Central Africa",
    ],
  },
  {
    label: "Category change candidates",
    examples: [
      "near threatened species with declining populations",
      "LC species with very few observations",
      "vulnerable migratory birds",
    ],
  },
  {
    label: "Assessor & region queries",
    examples: [
      "plant assessments by Steve Bachman",
      "reptile assessors in the Caribbean",
      "who reviews amphibians in Madagascar",
    ],
  },
  {
    label: "Explore & discover",
    examples: [
      "a random endangered bird from South Africa",
      "critically endangered marine mammals",
      "extinct in the wild species",
    ],
  },
];

export function AiSearchButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<ReasoningStep[]>([]);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [showExamples, setShowExamples] = useState(false);
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const stepsEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-scroll reasoning panel
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    setIsOpen(false);
    setError(null);
    setSteps([]);
    setExplanation(null);
    setShowExamples(false);
  }, []);

  function submitQuery(q: string) {
    setQuery(q);
    setShowExamples(false);
    // Trigger submit on next tick after state updates
    requestAnimationFrame(() => {
      doSubmit(q);
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim() || loading) return;
    doSubmit(query.trim());
  }

  async function doSubmit(q: string) {
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setSteps([]);
    setExplanation(null);
    setShowExamples(false);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, model: selectedModel }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        let eventType = "";
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7);
          } else if (line.startsWith("data: ") && eventType) {
            try {
              const data = JSON.parse(line.slice(6));
              handleSSEEvent(eventType, data);
            } catch {
              // skip malformed JSON
            }
            eventType = "";
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function handleSSEEvent(event: string, data: Record<string, unknown>) {
    switch (event) {
      case "thinking":
        setSteps((prev) => [...prev, { type: "thinking", text: data.text as string }]);
        break;
      case "reasoning":
        setSteps((prev) => [...prev, { type: "reasoning", text: data.text as string }]);
        break;
      case "tool_call": {
        const name = data.name as string;
        const args = data.args as Record<string, unknown>;
        const argsStr = Object.entries(args)
          .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
          .join(", ");
        setSteps((prev) => [
          ...prev,
          { type: "tool_call", text: `${formatToolName(name)}(${argsStr})` },
        ]);
        break;
      }
      case "tool_result": {
        const result = data.result as string;
        const display = result.length > 300 ? result.slice(0, 300) + "…" : result;
        setSteps((prev) => [...prev, { type: "tool_result", text: display }]);
        break;
      }
      case "result": {
        const qs = data.queryString as string;
        const expl = data.explanation as string;
        setExplanation(expl);
        window.history.pushState(null, "", "/" + qs);
        window.dispatchEvent(new PopStateEvent("popstate"));
        setLoading(false);
        break;
      }
      case "error":
        setError(data.message as string);
        setLoading(false);
        break;
    }
  }

  function formatToolName(name: string): string {
    switch (name) {
      case "search_species": return "Searching species";
      case "search_assessors": return "Looking up assessors";
      case "get_taxonomy_subgroups": return "Checking subgroups";
      case "pick_random_species": return "Picking a random species";
      default: return name;
    }
  }

  const hasActivity = steps.length > 0 || explanation || error;

  return (
    <div ref={panelRef} className="relative">
      {/* Sparkle toggle button */}
      <button
        onClick={() => {
          if (isOpen) {
            handleClose();
          } else {
            setIsOpen(true);
            setError(null);
            setSteps([]);
            setExplanation(null);
          }
        }}
        title="AI Search — describe what you're looking for"
        className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-colors ${
          isOpen
            ? "border-violet-400 dark:border-violet-500 bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400"
            : "border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:border-violet-300 dark:hover:border-violet-600 hover:text-violet-500 dark:hover:text-violet-400"
        }`}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
          />
        </svg>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 z-50 mt-2 w-80 sm:w-[26rem] rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 shadow-xl">
          <div className="px-3 pt-3 pb-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <p className="text-xs font-medium text-violet-600 dark:text-violet-400">
                  AI Search
                </p>
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="text-[10px] pl-1 pr-0.5 py-0 rounded border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-zinc-500 dark:text-zinc-400 focus:outline-none focus:ring-1 focus:ring-violet-400"
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
              </div>
              {!hasActivity && (
                <button
                  onClick={() => setShowExamples(!showExamples)}
                  className="text-[11px] text-zinc-400 dark:text-zinc-500 hover:text-violet-500 dark:hover:text-violet-400 transition-colors"
                >
                  {showExamples ? "Hide examples" : "Show examples"}
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-2">
              Describe what you&apos;re looking for in plain English — filter by taxa, region, threat, assessor, GBIF data, and more.
            </p>
            <form onSubmit={handleSubmit} className="flex gap-1.5">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='e.g. "DD freshwater fish with 1000+ new observations"'
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

            {/* Reasoning / activity log */}
            {hasActivity && (
              <div className="mt-2 max-h-52 overflow-y-auto rounded-md border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900 text-[11px] leading-relaxed">
                <div className="px-2 py-1.5 space-y-1">
                  {steps.map((step, i) => (
                    <StepRow key={i} step={step} />
                  ))}
                  {loading && steps.length > 0 && (
                    <div className="flex items-center gap-1 text-zinc-400">
                      <div className="h-3 w-3 rounded-full animate-spin border border-zinc-300 dark:border-zinc-600 border-t-transparent" />
                      <span>Thinking…</span>
                    </div>
                  )}
                  {explanation && (
                    <div className="pt-1 border-t border-zinc-200 dark:border-zinc-700 text-emerald-600 dark:text-emerald-400 font-medium">
                      ✓ {explanation}
                    </div>
                  )}
                  {error && (
                    <div className="text-red-600 dark:text-red-400">{error}</div>
                  )}
                  <div ref={stepsEndRef} />
                </div>
              </div>
            )}

            {/* Examples panel */}
            {showExamples && !hasActivity && (
              <div className="mt-2 max-h-64 overflow-y-auto rounded-md border border-zinc-100 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900">
                <div className="px-2 py-1.5 space-y-2">
                  {EXAMPLE_CATEGORIES.map((cat) => (
                    <div key={cat.label}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mb-0.5">
                        {cat.label}
                      </p>
                      {cat.examples.map((ex) => (
                        <button
                          key={ex}
                          onClick={() => submitQuery(ex)}
                          className="block w-full text-left text-[11px] px-1.5 py-0.5 rounded text-zinc-600 dark:text-zinc-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
                        >
                          &ldquo;{ex}&rdquo;
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Compact hints when examples panel is closed */}
            {!hasActivity && !showExamples && (
              <div className="mt-2 text-[11px] text-zinc-400 dark:text-zinc-500 leading-relaxed">
                Supports reassessment triage, data gaps, threats, assessor lookup, random species, and more.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StepRow({ step }: { step: ReasoningStep }) {
  switch (step.type) {
    case "thinking":
      return (
        <div className="text-zinc-400 dark:text-zinc-500 italic">
          {step.text}
        </div>
      );
    case "reasoning":
      return (
        <div className="text-zinc-600 dark:text-zinc-300">
          {step.text}
        </div>
      );
    case "tool_call":
      return (
        <div className="flex items-start gap-1 text-violet-600 dark:text-violet-400">
          <svg className="h-3 w-3 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
          </svg>
          <span>{step.text}</span>
        </div>
      );
    case "tool_result":
      return (
        <div className="pl-4 text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-words font-mono text-[10px]">
          {step.text}
        </div>
      );
  }
}
