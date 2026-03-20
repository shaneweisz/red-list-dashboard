"use client";

import { useState } from "react";

interface AssessmentAssistantProps {
  speciesKey: number;
  assessmentYear?: number | null;
}

export default function AssessmentAssistant({ speciesKey: _speciesKey, assessmentYear: _assessmentYear }: AssessmentAssistantProps) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <button
        className="flex items-center justify-center w-full"
        onClick={() => setCollapsed(!collapsed)}
      >
        <div>
          <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
            AI Assessment Assistant
          </h3>
        </div>
        <svg
          className={`w-4 h-4 text-zinc-400 transition-transform ${collapsed ? "" : "rotate-180"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (<>
        {/* Criterion tabs */}
        <div className="flex items-center justify-center gap-1 border-b border-zinc-200 dark:border-zinc-700 -mx-4 px-4">
          {["Criterion A", "Criterion B", "Criterion C", "Criterion D", "Criterion E", "Supporting Info"].map((label) => (
            <span
              key={label}
              className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-600 cursor-default border-b-2 border-transparent"
            >
              {label}
            </span>
          ))}
        </div>

        <div className="text-center py-10 text-zinc-400 dark:text-zinc-500">
          <svg className="w-10 h-10 mx-auto mb-3 text-zinc-300 dark:text-zinc-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
          </svg>
          <p className="text-sm font-medium">Coming soon</p>
        </div>
      </>)}
    </div>
  );
}
