"use client";

import { useState, useEffect } from "react";

interface MatchedSpecies {
  scientificName: string;
  category: string;
  year: string;
}

interface AssessorCandidate {
  name: string;
  assessmentCount: number;
  recentYear: string;
  matchedSpecies: MatchedSpecies[];
}

interface SuggestedAssessorsProps {
  scientificName: string;
  taxonGroup: string;
}

export default function SuggestedAssessors({ scientificName, taxonGroup }: SuggestedAssessorsProps) {
  const [candidates, setCandidates] = useState<AssessorCandidate[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(
      `/api/redlist/assessor-candidates?scientificName=${encodeURIComponent(scientificName)}&taxonGroup=${encodeURIComponent(taxonGroup)}`,
      { signal: controller.signal }
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setCandidates(data.candidates);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [scientificName, taxonGroup]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        Finding assessor candidates...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-red-500 py-1">
        Failed to load assessor suggestions
      </div>
    );
  }

  if (!candidates || candidates.length === 0) {
    return (
      <div className="text-xs text-zinc-400 italic py-1">
        No assessor candidates found for this taxon group
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">Suggested Assessor Candidates</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {candidates.map((candidate, idx) => (
          <div
            key={candidate.name}
            className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-2.5 bg-white dark:bg-zinc-800/50"
          >
            <div className="flex items-start gap-2">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[10px] font-bold flex items-center justify-center">
                {idx + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-zinc-800 dark:text-zinc-200 truncate" title={candidate.name}>
                  {candidate.name}
                </div>
                <div className="text-[10px] text-zinc-400 mt-0.5">
                  {candidate.assessmentCount} assessment{candidate.assessmentCount !== 1 ? "s" : ""} in group
                  {" "}&middot;{" "}latest {candidate.recentYear}
                </div>
                {candidate.matchedSpecies.length > 0 && (
                  <div className="mt-1.5 space-y-0.5">
                    {candidate.matchedSpecies.map((sp) => (
                      <div key={sp.scientificName} className="text-[10px] text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                        <span className="italic truncate">{sp.scientificName}</span>
                        <span
                          className="flex-shrink-0 px-1 rounded text-[9px] font-semibold"
                          style={{ backgroundColor: getCategoryColor(sp.category) + "20", color: getCategoryColor(sp.category) }}
                        >
                          {sp.category}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function getCategoryColor(code: string): string {
  const colors: Record<string, string> = {
    EX: "#000000", EW: "#542344", CR: "#d81e05", EN: "#fc7f3f",
    VU: "#f9e814", NT: "#cce226", LC: "#60c659", DD: "#d1d1c6",
    NE: "#ffffff",
  };
  return colors[code] ?? "#6b7280";
}
