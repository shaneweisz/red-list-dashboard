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
    <div className="p-4 md:p-6 space-y-5">
      {/* Header: Listing summary */}
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

      {/* Trade suspensions */}
      {data.suspensions && data.suspensions.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Trade Suspensions ({data.suspensions.length})
          </h4>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Country
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Type
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Since
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    Notification
                  </th>
                </tr>
              </thead>
              <tbody>
                {suspensionsToShow.map((s, i) => (
                  <tr
                    key={i}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                      {s.country}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400 capitalize">
                      {s.appliesTo}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                      {new Date(s.startDate).toLocaleDateString("en-GB", {
                        year: "numeric",
                        month: "short",
                      })}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 hidden md:table-cell">
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
                        s.notification?.name || "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.suspensions.length > 5 && (
              <button
                className="w-full px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800"
                onClick={() => setShowAllSuspensions(!showAllSuspensions)}
              >
                {showAllSuspensions
                  ? "Show fewer"
                  : `Show all ${data.suspensions.length} suspensions`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Trade quotas */}
      {data.quotas && data.quotas.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Trade Quotas ({data.quotas.length})
          </h4>
          <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-50 dark:bg-zinc-800/50">
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Country
                  </th>
                  <th className="text-right px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400">
                    Quota
                  </th>
                  <th className="text-left px-3 py-1.5 font-medium text-zinc-500 dark:text-zinc-400 hidden md:table-cell">
                    Notes
                  </th>
                </tr>
              </thead>
              <tbody>
                {quotasToShow.map((q, i) => (
                  <tr
                    key={i}
                    className="border-t border-zinc-100 dark:border-zinc-800"
                  >
                    <td className="px-3 py-1.5 text-zinc-700 dark:text-zinc-300">
                      {q.country}
                    </td>
                    <td className="px-3 py-1.5 text-right text-zinc-700 dark:text-zinc-300 tabular-nums">
                      {q.quota != null ? q.quota.toLocaleString() : "—"}
                      {q.unit ? ` ${q.unit}` : ""}
                    </td>
                    <td className="px-3 py-1.5 text-zinc-400 max-w-[250px] truncate hidden md:table-cell">
                      {q.notes || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.quotas.length > 5 && (
              <button
                className="w-full px-3 py-1.5 text-xs text-blue-600 dark:text-blue-400 hover:bg-zinc-50 dark:hover:bg-zinc-800/50 border-t border-zinc-100 dark:border-zinc-800"
                onClick={() => setShowAllQuotas(!showAllQuotas)}
              >
                {showAllQuotas
                  ? "Show fewer"
                  : `Show all ${data.quotas.length} quotas`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Current listings detail — shown below the trade info */}
      {data.currentListings && data.currentListings.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Current Listings
          </h4>
          <div className="space-y-2">
            {data.currentListings.map((listing, i) => (
              <div
                key={i}
                className="flex flex-wrap items-start gap-2 text-sm"
              >
                <AppendixBadge appendix={listing.appendix} />
                <span className="text-zinc-500 dark:text-zinc-400 text-xs mt-0.5">
                  since{" "}
                  {new Date(listing.effectiveAt).toLocaleDateString("en-GB", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {listing.annotation && (
                  <p className="w-full text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 pl-0.5">
                    {listing.annotation}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reservations — country-specific opt-outs from a listing */}
      {data.reservations && data.reservations.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider mb-2">
            Reservations ({data.reservations.length})
          </h4>
          <div className="space-y-2">
            {data.reservations.map((r, i) => (
              <div
                key={i}
                className="flex flex-wrap items-start gap-2 text-sm"
              >
                <AppendixBadge appendix={r.appendix} />
                <span className="text-zinc-700 dark:text-zinc-300">
                  {r.country || r.countryCode || "Unknown party"}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400 text-xs mt-0.5">
                  since{" "}
                  {new Date(r.effectiveAt).toLocaleDateString("en-GB", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                  })}
                </span>
                {r.annotation && (
                  <p className="w-full text-xs text-zinc-500 dark:text-zinc-400 mt-0.5 pl-0.5">
                    {r.annotation}
                  </p>
                )}
              </div>
            ))}
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
