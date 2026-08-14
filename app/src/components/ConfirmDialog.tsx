"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ConfirmDialogProps {
  title: string;
  /** What will happen, in the reader's terms. */
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A yes/no for an action that overwrites something.
 *
 * Small enough to be worth having: the alternative to asking is an undo stack,
 * and for a change that replaces a coordinate someone worked out by hand, being
 * asked once is cheaper than either losing it or building the undo.
 */
export default function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div
        className="w-full max-w-sm rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 space-y-1">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</h2>
          {body && <div className="text-xs text-zinc-500 dark:text-zinc-400">{body}</div>}
        </div>
        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={onCancel}
            className="ml-auto px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className="px-3 py-1 rounded bg-zinc-800 dark:bg-zinc-200 hover:bg-zinc-900 dark:hover:bg-white text-xs text-white dark:text-zinc-900 font-medium transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
