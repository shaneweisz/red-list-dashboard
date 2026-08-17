"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  excludedRowsTsv,
  parseWorksheet,
  worksheetWithGeoreferences,
  type WorksheetImport,
} from "@/lib/georeferencing-worksheet";
import type { Exclusion, Georeference } from "@/lib/georeferences";

interface WorksheetSyncDialogProps {
  /** The sheet pasted earlier this session, if any. */
  imported: WorksheetImport | null;
  onImported: (imported: WorksheetImport) => void;
  /** Adds the georeferences read from the sheet to the ones already held. */
  onApply: (georeferences: Georeference[]) => void;
  /** Whether a row is the assessor's own work rather than GBIF's coordinates
   *  copied into the sheet — see isAssessorsOwn. */
  isOwnWork: (georeference: Georeference) => boolean;
  /** Whether the record is in the sample currently loaded from GBIF. */
  isLoaded: (gbifID: number) => boolean;
  georeferences: Record<number, Georeference>;
  exclusions: Record<number, Exclusion>;
  georeferencedBy?: string | null;
  scientificName?: string;
  onClose: () => void;
}

/**
 * The two-way trip between this tool and the georeferencing workbook.
 *
 * The point is that neither side has to be abandoned to try the other. An
 * assessor pastes the sheet they already keep, works here, and pastes it back
 * with the same columns in the same order — so the workbook's derived GeoCAT and
 * IUCN sheets keep working and nothing about their process has to change.
 *
 * Clipboard both ways: copying a range in Excel puts tab-separated text on the
 * clipboard, so there's no file to save, name, or find again.
 */
export default function WorksheetSyncDialog({
  imported,
  onImported,
  onApply,
  isOwnWork,
  isLoaded,
  georeferences,
  exclusions,
  georeferencedBy,
  scientificName,
  onClose,
}: WorksheetSyncDialogProps) {
  const [pasted, setPasted] = useState("");
  const [preview, setPreview] = useState<WorksheetImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const pasteRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const read = (text: string) => {
    setPasted(text);
    setError(null);
    if (text.trim() === "") {
      setPreview(null);
      return;
    }
    const result = parseWorksheet(text, { georeferencedBy, scientificName });
    if (!result.headers.some((h) => h.toUpperCase() === "GBIFID")) {
      setPreview(null);
      setError(
        "No GBIFID column found. Copy the Manual_georeferencing_data sheet including its header row."
      );
      return;
    }
    setPreview(result);
  };

  const copy = (label: string, text: string) => {
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(label);
        window.setTimeout(() => setCopied(null), 2000);
      },
      () => setCopied(null)
    );
  };

  const ownWork = preview ? preview.georeferences.filter(isOwnWork) : [];
  // A sheet routinely covers records this view hasn't loaded — the sample is
  // capped, and GBIF's holdings shift between exports. They're kept either way,
  // but silently not appearing on the map would read as the import failing.
  const notLoaded = ownWork.filter((g) => !isLoaded(g.gbifID)).length;

  const excludedCount = imported
    ? imported.rows.filter((row) => {
        const i = imported.headers.findIndex((h) => h.trim().toUpperCase() === "GBIFID");
        return i >= 0 && exclusions[Number(row[i]?.trim())];
      }).length
    : 0;

  return createPortal(
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-zinc-200 dark:border-zinc-700">
          <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">Georeferencing worksheet</h2>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Move work between here and the spreadsheet. Records are matched on GBIFID, and only the
            coordinate columns — LAT, LONG, ERRRAD, GEONOTES, LLORIG — are ever read or written.
          </p>
        </div>

        {/* In */}
        <div className="px-4 py-3 space-y-2 border-b border-zinc-200 dark:border-zinc-700">
          <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-200">From the spreadsheet</h3>
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            In Excel, select the <span className="font-mono">Manual_georeferencing_data</span> sheet
            including its header row, copy, and paste below.
          </p>
          <textarea
            ref={pasteRef}
            value={pasted}
            onChange={(e) => read(e.target.value)}
            rows={4}
            placeholder="Paste the sheet here"
            className="w-full px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 text-[11px] font-mono text-zinc-800 dark:text-zinc-100"
          />
          {error && <p className="text-[11px] text-amber-600 dark:text-amber-400">{error}</p>}
          {preview && (
            <div className="text-[11px] text-zinc-600 dark:text-zinc-300 space-y-1">
              <p>
                {preview.rows.length.toLocaleString()} rows, {preview.headers.length} columns.{" "}
                <strong>{ownWork.length.toLocaleString()}</strong> carry georeferencing of your own.
              </p>
              {preview.georeferences.length > ownWork.length && (
                <p className="text-zinc-400">
                  {(preview.georeferences.length - ownWork.length).toLocaleString()} more hold GBIF&apos;s
                  own coordinates unchanged — the sheet starts as a copy of the GBIF export, so those
                  aren&apos;t brought in as yours.
                </p>
              )}
              {notLoaded > 0 && (
                <p className="text-zinc-400">
                  {notLoaded.toLocaleString()} of them {notLoaded === 1 ? "is" : "are"} for records this
                  view hasn&apos;t loaded — they&apos;ll be kept, but won&apos;t appear on the map until
                  those records do.
                </p>
              )}
              {preview.withoutRadius > 0 && (
                <p className="text-zinc-400">
                  {preview.withoutRadius} of those state no error radius — they&apos;ll come in with none.
                </p>
              )}
              {preview.skipped.length > 0 && (
                <div className="text-amber-600 dark:text-amber-400">
                  <p>{preview.skipped.length} row(s) can&apos;t be read:</p>
                  <ul className="list-disc pl-4">
                    {preview.skipped.slice(0, 4).map((s) => (
                      <li key={s.row}>
                        row {s.row}: {s.reason}
                      </li>
                    ))}
                    {preview.skipped.length > 4 && <li>…and {preview.skipped.length - 4} more</li>}
                  </ul>
                </div>
              )}
              <button
                onClick={() => {
                  onImported(preview);
                  onApply(preview.georeferences);
                  setPasted("");
                  setPreview(null);
                }}
                className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-xs text-white font-medium"
              >
                Bring in {ownWork.length.toLocaleString()} georeference{ownWork.length === 1 ? "" : "s"}
              </button>
            </div>
          )}
        </div>

        {/* Out */}
        <div className="px-4 py-3 space-y-2">
          <h3 className="text-xs font-medium text-zinc-700 dark:text-zinc-200">Back to the spreadsheet</h3>
          {imported ? (
            <>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Copies the sheet you pasted with your coordinates written in, the same{" "}
                {imported.headers.length} columns in the same order — so the GeoCAT and IUCN sheets
                that read it by position keep working. Select the same range in Excel and paste.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    copy("sheet", worksheetWithGeoreferences(imported, georeferences, exclusions))
                  }
                  className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Copy the sheet
                </button>
                {excludedCount > 0 && (
                  <button
                    onClick={() => copy("excluded", excludedRowsTsv(imported, exclusions))}
                    title="Excluding a record in the sheet means deleting its row, which loses the reason with it"
                    className="px-2 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                  >
                    Copy the {excludedCount} excluded row{excludedCount === 1 ? "" : "s"} and reasons
                  </button>
                )}
                {copied && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                    {copied === "sheet" ? "Sheet copied" : "Exclusions copied"}
                  </span>
                )}
              </div>
              {excludedCount > 0 && (
                <p className="text-[11px] text-zinc-400">
                  The {excludedCount} record{excludedCount === 1 ? "" : "s"} you struck out{" "}
                  {excludedCount === 1 ? "is" : "are"} left out of the sheet, as deleting the row
                  would do — take the reasons separately so they aren&apos;t lost.
                </p>
              )}
            </>
          ) : (
            <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
              Paste your sheet above first. Writing the columns back in the order the workbook
              expects means starting from the sheet itself — guessing at it is what turns the
              derived GeoCAT and IUCN sheets into #REF!.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-zinc-200 dark:border-zinc-700">
          <button
            onClick={onClose}
            className="ml-auto px-3 py-1 rounded border border-zinc-300 dark:border-zinc-600 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
