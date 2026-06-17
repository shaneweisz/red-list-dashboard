"use client";

import { useState, useEffect, useMemo } from "react";
import CitesTradeSummary from "./CitesTradeSummary";
import type { CountryAnnotation } from "./TradeFlowMap";

interface CitesListing {
  appendix: string;
  effectiveAt: string;
  annotation: string | null;
}

interface CitesReservation {
  appendix: string;
  effectiveAt: string;
  annotation: string | null;
  country: string | null;
  countryCode: string | null;
}

interface CitesSuspension {
  country: string;
  countryCode: string;
  notes: string | null;
  startDate: string;
  appliesTo: "import" | "export";
  notification: { name: string; url: string | null } | null;
}

interface CitesQuota {
  country: string;
  countryCode: string;
  quota: number;
  unit: string | null;
  notes: string | null;
  publicationDate: string;
}

interface CitesCountry {
  name: string;
  code: string;
}

interface CitesData {
  found: boolean;
  scientificName: string;
  authorYear?: string | null;
  rank?: string;
  citesListing?: string | null;
  citesId?: number;
  englishName?: string | null;
  taxonomy?: {
    kingdom?: string;
    phylum?: string;
    class?: string;
    order?: string;
    family?: string;
  };
  currentListings?: CitesListing[];
  reservations?: CitesReservation[];
  suspensions?: CitesSuspension[];
  quotas?: CitesQuota[];
  nativeCountries?: CitesCountry[];
  extinctCountries?: CitesCountry[];
  cached?: boolean;
  error?: string;
}

const APPENDIX_COLORS: Record<string, string> = {
  I: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  II: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  III: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
};

function AppendixBadge({ appendix }: { appendix: string }) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${APPENDIX_COLORS[appendix] || "bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200"}`}
    >
      Appendix {appendix}
    </span>
  );
}

const fmtCitesDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

/** Compact section header with an optional count. */
function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-baseline gap-2 mb-1.5">
      <h4 className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        {title}
      </h4>
      {count != null && (
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

export default function CitesSummary({
  scientificName,
}: {
  scientificName: string;
}) {
  const [data, setData] = useState<CitesData | null>(null);
  const [tradeData, setTradeData] = useState<Record<string, unknown> | null>(null);
  const [tradeLoading, setTradeLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllSuspensions, setShowAllSuspensions] = useState(false);
  const [showAllQuotas, setShowAllQuotas] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchCitesData() {
      setLoading(true);
      setTradeData(null);
      setError(null);

      try {
        const res = await fetch(
          `/api/cites?name=${encodeURIComponent(scientificName)}`
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const result = await res.json();
        if (cancelled) return;
        setData(result);
        setLoading(false);

        // Start trade data fetch immediately (eliminates waterfall)
        if (result.found && result.citesId) {
          setTradeLoading(true);
          try {
            const tradeRes = await fetch(`/api/cites/trade?taxon_id=${result.citesId}`);
            if (tradeRes.ok && !cancelled) {
              setTradeData(await tradeRes.json());
            }
          } catch {
            // Trade data is optional — fail silently
          } finally {
            if (!cancelled) setTradeLoading(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unknown error");
          setLoading(false);
        }
      }
    }

    fetchCitesData();

    return () => {
      cancelled = true;
    };
  }, [scientificName]);

  // Country codes with active trade suspensions — passed to TradeFlowMap for overlay
  // Must be before early returns to satisfy Rules of Hooks
  const suspensionCountryCodes = useMemo(
    () => new Set((data?.suspensions || []).map((s) => s.countryCode)),
    [data?.suspensions]
  );

  // Per-country annotations (suspensions + quotas) for map hover tooltips
  const countryAnnotations = useMemo(() => {
    const map: Record<string, CountryAnnotation> = {};
    for (const s of data?.suspensions || []) {
      if (!map[s.countryCode]) map[s.countryCode] = {};
      if (!map[s.countryCode].suspensions) map[s.countryCode].suspensions = [];
      map[s.countryCode].suspensions!.push({ type: s.appliesTo, startDate: s.startDate });
    }
    for (const q of data?.quotas || []) {
      if (!map[q.countryCode]) map[q.countryCode] = {};
      if (!map[q.countryCode].quotas) map[q.countryCode].quotas = [];
      map[q.countryCode].quotas!.push({ quota: q.quota, unit: q.unit });
    }
    return map;
  }, [data?.suspensions, data?.quotas]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-zinc-500 dark:text-zinc-400">
        <svg
          className="animate-spin h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        Loading CITES data...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm text-red-500 dark:text-red-400">
        Failed to load CITES data: {error}
      </div>
    );
  }

  if (!data || !data.found) {
    return (
      <div className="p-6 text-sm text-zinc-500 dark:text-zinc-400">
        <span className="italic">{scientificName}</span> is not listed in the
        CITES database.
      </div>
    );
  }

  const suspensionsToShow = showAllSuspensions
    ? data.suspensions || []
    : (data.suspensions || []).slice(0, 5);
  const quotasToShow = showAllQuotas
    ? data.quotas || []
    : (data.quotas || []).slice(0, 5);

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Listing summary + external links */}
      <div className="flex flex-wrap items-center gap-3">
        {data.citesListing ? (
          <div className="flex items-center gap-2">
            {data.citesListing.split("/").map((app) => (
              <AppendixBadge key={app} appendix={app.trim()} />
            ))}
          </div>
        ) : (
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            No current CITES listing
          </span>
        )}
        <div className="flex items-center gap-3 ml-auto">
          <a
            href={`https://trade.cites.org/en/cites_trade/download?filters%5Btaxon_concepts_ids%5D%5B%5D=${data.citesId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View on CITES Trade Database
          </a>
          <span className="text-zinc-300 dark:text-zinc-600">|</span>
          <a
            href={`https://www.speciesplus.net/species#/taxon_concepts/${data.citesId}/legal`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
          >
            View on Species+
          </a>
        </div>
      </div>

      {/* Trade overview from CITES Trade Database */}
      {data.citesId && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            International Trade
          </h4>
          <CitesTradeSummary citesId={data.citesId} prefetchedData={tradeData} prefetchedLoading={tradeLoading} suspensionCountries={suspensionCountryCodes} countryAnnotations={countryAnnotations} />
        </div>
      )}

      {/* Listings & reservations — compact, side by side on wider screens */}
      {((data.currentListings && data.currentListings.length > 0) ||
        (data.reservations && data.reservations.length > 0)) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-4">
          {data.currentListings && data.currentListings.length > 0 && (
            <div>
              <SectionHeader title="Current Listings" />
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.currentListings.map((listing, i) => (
                  <div key={i} className="px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <AppendixBadge appendix={listing.appendix} />
                      <span className="text-zinc-400 dark:text-zinc-500 ml-auto whitespace-nowrap">
                        since {fmtCitesDate(listing.effectiveAt)}
                      </span>
                    </div>
                    {listing.annotation && (
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                        {listing.annotation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.reservations && data.reservations.length > 0 && (
            <div>
              <SectionHeader title="Reservations" count={data.reservations.length} />
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800">
                {data.reservations.map((r, i) => (
                  <div key={i} className="px-3 py-2">
                    <div className="flex items-center gap-2 text-xs">
                      <AppendixBadge appendix={r.appendix} />
                      <span className="text-zinc-700 dark:text-zinc-300 font-medium truncate">
                        {r.country || r.countryCode || "Unknown party"}
                      </span>
                      <span className="text-zinc-400 dark:text-zinc-500 ml-auto whitespace-nowrap">
                        since {fmtCitesDate(r.effectiveAt)}
                      </span>
                    </div>
                    {r.annotation && (
                      <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 leading-snug">
                        {r.annotation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade suspensions */}
      {data.suspensions && data.suspensions.length > 0 && (
        <div>
          <SectionHeader title="Trade Suspensions" count={data.suspensions.length} />
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <tbody>
                {suspensionsToShow.map((s, i) => (
                  <tr
                    key={i}
                    className="border-t first:border-t-0 border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-1 text-zinc-700 dark:text-zinc-300">
                      {s.country}
                    </td>
                    <td className="px-3 py-1 text-zinc-500 dark:text-zinc-400 capitalize whitespace-nowrap">
                      {s.appliesTo}
                    </td>
                    <td className="px-3 py-1 text-zinc-500 dark:text-zinc-400 whitespace-nowrap tabular-nums">
                      {new Date(s.startDate).toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="px-3 py-1 text-right hidden md:table-cell">
                      {s.notification?.url ? (
                        <a
                          href={s.notification.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:underline"
                        >
                          {s.notification.name}
                        </a>
                      ) : (
                        <span className="text-zinc-400">{s.notification?.name || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.suspensions.length > 5 && (
              <button
                className="w-full px-3 py-1 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800"
                onClick={() => setShowAllSuspensions(!showAllSuspensions)}
              >
                {showAllSuspensions
                  ? "Show fewer"
                  : `Show all ${data.suspensions.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Trade quotas */}
      {data.quotas && data.quotas.length > 0 && (
        <div>
          <SectionHeader title="Trade Quotas" count={data.quotas.length} />
          <div className="border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-[11px]">
              <tbody>
                {quotasToShow.map((q, i) => (
                  <tr
                    key={i}
                    className="border-t first:border-t-0 border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-1 text-zinc-700 dark:text-zinc-300 whitespace-nowrap">
                      {q.country}
                    </td>
                    <td className="px-3 py-1 text-right text-zinc-700 dark:text-zinc-300 tabular-nums whitespace-nowrap">
                      {q.quota != null ? q.quota.toLocaleString() : "—"}
                      {q.unit ? ` ${q.unit}` : ""}
                    </td>
                    <td className="px-3 py-1 text-zinc-400 max-w-[280px] truncate hidden md:table-cell">
                      {q.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.quotas.length > 5 && (
              <button
                className="w-full px-3 py-1 text-[11px] text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800"
                onClick={() => setShowAllQuotas(!showAllQuotas)}
              >
                {showAllQuotas
                  ? "Show fewer"
                  : `Show all ${data.quotas.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Footer attribution — required by Species+ Terms of Use */}
      <div className="text-xs sm:text-[10px] text-zinc-400 dark:text-zinc-500 pt-2 space-y-1">
        <p>
          UNEP ({new Date().getFullYear()}).{" "}
          <a
            href="https://www.speciesplus.net"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            The Species+ Website
          </a>
          . Nairobi, Kenya. Compiled by UNEP-WCMC, Cambridge, UK.
          Available at:{" "}
          <a
            href="https://www.speciesplus.net"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            www.speciesplus.net
          </a>
          . [Accessed{" "}
          {new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
          })}
          ].
        </p>
        <p>
          Subject to Species+{" "}
          <a
            href="https://www.speciesplus.net/terms-of-use"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:underline"
          >
            Terms of Use
          </a>
          .
        </p>
      </div>
    </div>
  );
}
