"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { EXCLUSION_REASONS } from "@/lib/georeferences";

interface ExclusionDialogProps {
  /** The records being struck out — one, or a set selected together. */
  gbifIDs: number[];
  /** Pre-filled when re-opening an exclusion to edit its reason. */
  existingJustification?: string;
  onConfirm: (justification: string) => void;
  onCancel: () => void;
}

/**
 * Asks why, and won't take an empty answer.
 *
 * Excluding a record is a judgement about the evidence, and the next person to
 * read the assessment — or the same person in six months — needs to know which
 * judgement it was. Duplicates in particular tend to come in runs, which is why
 * this takes a set of records rather than one at a time.
 */
export default function ExclusionDialog({
  gbifIDs,
  existingJustification,
  onConfirm,
  onCancel,
}: ExclusionDialogProps) {
  const [justification, setJustification] = useState(existingJustification ?? "");
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  const confirm = () => {
    if (justification.trim() === "") {
      setShowError(true);
      return;
    }
    onConfirm(justification.trim());
  };

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {existingJustification
              ? gbifIDs.length === 1
                ? "Edit exclusion reason"
                : `Edit reason for ${gbifIDs.length} records`
              : gbifIDs.length === 1
                ? "Exclude this record"
                : `Exclude ${gbifIDs.length} records`}
          </h2>
          {gbifIDs.length === 1 && (
            <p className="text-[11px] text-zinc-400 mt-0.5">
              GBIF record{" "}
              <a
                href={`https://www.gbif.org/occurrence/${gbifIDs[0]}`}
                target="_blank"
                rel="noopener noreferrer"
                className="tabular-nums text-blue-600 dark:text-blue-400 hover:underline"
              >
                {gbifIDs[0]}
              </a>
            </p>
          )}
        </div>

        <div className="px-4 py-3 space-y-2">
          <div className="flex flex-wrap gap-1">
            {EXCLUSION_REASONS.map((reason) => (
              <button
                key={reason}
                onClick={() => {
                  setJustification(reason);
                  setShowError(false);
                }}
                className={`px-1.5 py-0.5 rounded border text-[11px] transition-colors ${
                  justification === reason
                    ? "bg-zinc-200 dark:bg-zinc-700 border-zinc-400 dark:border-zinc-500 text-zinc-800 dark:text-zinc-100"
                    : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {reason}
              </button>
            ))}
          </div>
          <label className="block text-xs">
            <span className="block mb-1 text-zinc-500 dark:text-zinc-400">
              Reason <span className="text-amber-600 dark:text-amber-400">required</span>
            </span>
            <textarea
              value={justification}
              autoFocus
              rows={2}
              onChange={(e) => {
                setJustification(e.target.value);
                setShowError(false);
              }}
              placeholder="Why should this record be excluded?"
              className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-zinc-800 dark:text-zinc-100"
            />
          </label>
          {showError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">
              Give a reason — an exclusion nobody can audit is just missing data.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={onCancel}
            className="ml-auto px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            className="px-3 py-1 rounded bg-zinc-800 dark:bg-zinc-200 hover:bg-zinc-900 dark:hover:bg-white text-xs text-white dark:text-zinc-900 font-medium transition-colors"
          >
            {existingJustification
              ? "Save reason"
              : gbifIDs.length === 1
                ? "Exclude"
                : `Exclude ${gbifIDs.length}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
