"use client";

import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

// Dynamically import Leaflet components
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((mod) => mod.CircleMarker),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);
const LocateControl = dynamic(
  () => import("./LocateControl"),
  { ssr: false }
);
const FitBounds = dynamic(
  () => import("./FitBounds"),
  { ssr: false }
);

interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: number;
    species: string;
    eventDate?: string;
    basisOfRecord?: string;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

// Format basisOfRecord to human-readable string
function formatBasisOfRecord(basis?: string): string {
  if (!basis) return "";
  const labels: Record<string, string> = {
    HUMAN_OBSERVATION: "Human observation",
    PRESERVED_SPECIMEN: "Preserved specimen",
    MACHINE_OBSERVATION: "Machine observation",
    FOSSIL_SPECIMEN: "Fossil specimen",
    LIVING_SPECIMEN: "Living specimen",
    MATERIAL_SAMPLE: "Material sample",
    OCCURRENCE: "Occurrence",
    MATERIAL_CITATION: "Material citation",
  };
  return labels[basis] || basis.replace(/_/g, " ").toLowerCase();
}

interface InatObservation {
  url: string;
  date: string | null;
  imageUrl: string | null;
  location: string | null;
  observer: string | null;
}

interface RecordTypeBreakdown {
  humanObservation: number;
  preservedSpecimen: number;
  machineObservation: number;
  other: number;
  iNaturalist: number;
  recentInatObservations?: InatObservation[];
  inatTotalCount?: number;
  total?: number;
}

interface OccurrenceMapRowProps {
  speciesKey: number;
  countryCode?: string | null;
  mounted: boolean;
  colSpan: number;
  assessmentYear?: number | null;
}

// Convert iNaturalist photo URLs to a smaller size for thumbnails
// e.g. .../photos/123/original.jpeg -> .../photos/123/small.jpeg (240px)
function getThumbUrl(url: string): string {
  return url.replace(/\/original\./, '/small.');
}

// iNat photo thumbnail with hover preview using portal (desktop only)
function InatPhotoWithPreview({ obs, idx }: { obs: InatObservation; idx: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Detect touch devices to disable hover preview
    setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
  }, []);

  useEffect(() => {
    if (isHovered && thumbRef.current && !isTouchDevice) {
      const rect = thumbRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const previewWidth = 208; // w-52 = 13rem = 208px
      const previewHeight = 220; // approximate height

      // Position to the right of the thumbnail by default
      let left = rect.right + 4;
      let top = rect.top;

      // If preview would overflow right edge, position to the left
      if (left + previewWidth > viewportWidth) {
        left = rect.left - previewWidth - 4;
      }

      // If preview would overflow bottom, shift up
      if (top + previewHeight > viewportHeight) {
        top = viewportHeight - previewHeight - 8;
      }

      // Ensure it doesn't go above the viewport
      if (top < 8) {
        top = 8;
      }

      setPosition({ top, left });
    }
  }, [isHovered, isTouchDevice]);

  return (
    <div
      ref={thumbRef}
      className="aspect-square relative"
      onMouseEnter={() => !isTouchDevice && setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <a
        href={obs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full h-full"
      >
        {obs.imageUrl ? (
          <img
            src={getThumbUrl(obs.imageUrl)}
            alt={`iNaturalist observation ${idx + 1}`}
            className={`w-full h-full object-cover rounded ring-1 ring-zinc-200 dark:ring-zinc-700 transition-all ${isHovered ? 'ring-2 ring-blue-500' : ''}`}
          />
        ) : (
          <div className="w-full h-full bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 text-xs">
            ?
          </div>
        )}
      </a>
      {!isTouchDevice && isHovered && obs.imageUrl && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999]"
          style={{ top: position.top, left: position.left }}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-2xl border border-zinc-200 dark:border-zinc-700 overflow-hidden w-52">
            <a href={obs.url} target="_blank" rel="noopener noreferrer">
              <img
                src={obs.imageUrl}
                alt={`iNaturalist observation ${idx + 1}`}
                className="w-full h-40 object-cover hover:opacity-90 cursor-pointer"
              />
            </a>
            <div className="p-2 text-xs space-y-1">
              {obs.date && (
                <div className="text-zinc-500 dark:text-zinc-400">{obs.date}</div>
              )}
              {obs.observer && (
                <div className="text-zinc-700 dark:text-zinc-300 truncate">
                  <span className="text-zinc-400">by</span> {obs.observer}
                </div>
              )}
              {obs.location && (
                <div className="text-zinc-600 dark:text-zinc-400 truncate" title={obs.location}>
                  {obs.location}
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function OccurrenceMapRow({
  speciesKey,
  countryCode,
  mounted,
  colSpan,
  assessmentYear,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);
  const [showPreservedSpecimens, setShowPreservedSpecimens] = useState(false);

  // Total occurrences count (from API metadata)
  const [totalOccurrences, setTotalOccurrences] = useState<number | null>(null);
  // Bounding box from API: [minLon, minLat, maxLon, maxLat]
  const [bbox, setBbox] = useState<[number, number, number, number] | null>(null);

  // Fetch occurrences immediately (limited sample for performance)
  useEffect(() => {
    setLoadingOccurrences(true);
    const params = new URLSearchParams({
      speciesKey: speciesKey.toString(),
      limit: "500",
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/occurrences?${params}`)
      .then((res) => res.json())
      .then((data) => {
        setOccurrences(data.features || []);
        setTotalOccurrences(data.metadata?.total ?? null);
        setBbox(data.metadata?.bbox ?? null);
      })
      .catch(console.error)
      .finally(() => setLoadingOccurrences(false));
  }, [speciesKey, countryCode]);

  // Fetch breakdown data
  useEffect(() => {
    setLoadingBreakdown(true);
    const params = new URLSearchParams();
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/species/${speciesKey}/breakdown?${params}`)
      .then((res) => res.json())
      .then((data) => setBreakdown(data))
      .catch(console.error)
      .finally(() => setLoadingBreakdown(false));
  }, [speciesKey, countryCode]);

  // Helper to check if a record is a preserved specimen or material sample
  const isPreserved = (basisOfRecord?: string): boolean => {
    return basisOfRecord === "PRESERVED_SPECIMEN" || basisOfRecord === "MATERIAL_SAMPLE";
  };

  // Filter occurrences to exclude preserved specimens and material samples when toggle is off
  const filteredOccurrences = showPreservedSpecimens
    ? occurrences
    : occurrences.filter((o) => !isPreserved(o.properties.basisOfRecord));

  // Helper to check if an occurrence is after the assessment year
  const isNewRecord = (eventDate?: string): boolean => {
    if (!assessmentYear || !eventDate) return false;
    const recordYear = new Date(eventDate).getFullYear();
    return recordYear > assessmentYear;
  };

  // Count by category for the legend
  const preservedRecords = filteredOccurrences.filter((o) => isPreserved(o.properties.basisOfRecord));
  const newRecords = filteredOccurrences.filter((o) => !isPreserved(o.properties.basisOfRecord) && isNewRecord(o.properties.eventDate));
  const oldRecords = filteredOccurrences.filter((o) => !isPreserved(o.properties.basisOfRecord) && !isNewRecord(o.properties.eventDate));

  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <div
          className="bg-zinc-50 dark:bg-zinc-800/50 border-t border-zinc-200 dark:border-zinc-700"
          style={{ maxWidth: 'calc(100vw - 2rem)', transform: 'translateX(var(--scroll-left, 0px))' }}
        >
          <div className="p-2">
            {/* Main layout: 1/3 left (breakdown + photos), 2/3 right (map) */}
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Left column: Breakdown + iNat photos (1/3 width) */}
              <div className="lg:w-1/3 flex flex-col gap-3 relative z-10">
                {/* Observation type breakdown */}
                <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Observation Types</div>
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showPreservedSpecimens}
                        onChange={(e) => setShowPreservedSpecimens(e.target.checked)}
                        className="w-3.5 h-3.5 rounded accent-blue-500"
                      />
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Include preserved specimens/samples</span>
                    </label>
                  </div>
                  {loadingBreakdown ? (
                    <div className="text-zinc-400 text-sm animate-pulse">Loading...</div>
                  ) : breakdown ? (() => {
                    const baseParams = `taxon_key=${speciesKey}&has_coordinate=true&has_geospatial_issue=false${countryCode ? `&country=${countryCode}` : ''}`;
                    return (
                    <div className="space-y-1 text-sm">
                      <a
                        href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=HUMAN_OBSERVATION`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex justify-between text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        <span>Human observations</span>
                        <span className="tabular-nums">{breakdown.humanObservation.toLocaleString()}</span>
                      </a>
                      {breakdown.iNaturalist > 0 && (
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between text-zinc-500 dark:text-zinc-400 pl-3 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>iNaturalist</span>
                          <span className="tabular-nums">{breakdown.iNaturalist.toLocaleString()}</span>
                        </a>
                      )}
                      <a
                        href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=PRESERVED_SPECIMEN`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex justify-between text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        <span>Preserved specimens</span>
                        <span className="tabular-nums">{breakdown.preservedSpecimen.toLocaleString()}</span>
                      </a>
                      <a
                        href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=MACHINE_OBSERVATION`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex justify-between text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        <span>Machine observations</span>
                        <span className="tabular-nums">{breakdown.machineObservation.toLocaleString()}</span>
                      </a>
                      {breakdown.other > 0 && (
                        <div className="flex justify-between text-zinc-600 dark:text-zinc-400">
                          <span>Other</span>
                          <span className="tabular-nums">{breakdown.other.toLocaleString()}</span>
                        </div>
                      )}
                      <a
                        href={`https://www.gbif.org/occurrence/search?${baseParams}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="border-t border-zinc-200 dark:border-zinc-700 pt-1 mt-1 flex justify-between font-medium text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                      >
                        <span>Total</span>
                        <span className="tabular-nums">{breakdown.total?.toLocaleString() || (breakdown.humanObservation + breakdown.preservedSpecimen + breakdown.machineObservation + breakdown.other).toLocaleString()}</span>
                      </a>
                    </div>
                    );
                  })() : null}
                </div>

                {/* iNaturalist photos grid */}
                {breakdown?.recentInatObservations && breakdown.recentInatObservations.length > 0 && (
                  <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 flex-1 overflow-hidden">
                    <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center gap-2">
                      <span>iNaturalist</span>
                      <span className="text-zinc-400 text-xs">({breakdown.inatTotalCount?.toLocaleString() || breakdown.iNaturalist.toLocaleString()} total)</span>
                    </div>
                    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5 sm:gap-1">
                      {breakdown.recentInatObservations.map((obs, idx) => (
                        <InatPhotoWithPreview key={idx} obs={obs} idx={idx} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Map (2/3 width) */}
              <div className="lg:w-2/3 flex flex-col gap-2">
                {/* Map */}
                <div className="h-[300px] md:h-[400px] rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700 relative isolate z-0">
              {loadingOccurrences ? (
                <div className="flex items-center justify-center h-full bg-zinc-100 dark:bg-zinc-800">
                  <div className="text-zinc-400">Loading occurrences...</div>
                </div>
              ) : mounted ? (
                <MapContainer
                  center={[20, 0]}
                  zoom={2}
                  style={{ height: "100%", width: "100%" }}
                >
                  <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />
                  <LocateControl />
                  {bbox && <FitBounds bbox={bbox} />}
                  {/* Render occurrences: preserved (amber), old observations (grey), new observations (green) */}
                  {filteredOccurrences.map((feature, idx) => {
                    const [lon, lat] = feature.geometry.coordinates;
                    const preserved = isPreserved(feature.properties.basisOfRecord);
                    const isNew = isNewRecord(feature.properties.eventDate);
                    // Color: preserved=amber, new=green, old=grey
                    const strokeColor = preserved ? "#b45309" : isNew ? "#15803d" : "#6b7280";
                    const fillColor = preserved ? "#f59e0b" : isNew ? "#22c55e" : "#9ca3af";
                    return (
                      <CircleMarker
                        key={feature.properties.gbifID || idx}
                        center={[lat, lon]}
                        radius={5}
                        pathOptions={{
                          color: strokeColor,
                          fillColor: fillColor,
                          fillOpacity: 0.9,
                          weight: 2,
                        }}
                      >
                        <Popup>
                          <div className="text-sm">
                            <div className="font-medium italic">
                              {feature.properties.species}
                            </div>
                            {feature.properties.basisOfRecord && (
                              <div className="text-xs text-gray-600">
                                {formatBasisOfRecord(feature.properties.basisOfRecord)}
                              </div>
                            )}
                            {feature.properties.eventDate && (
                              <div className="text-xs">
                                {feature.properties.eventDate}
                              </div>
                            )}
                            <div className="text-xs text-gray-500">
                              {lat.toFixed(4)}, {lon.toFixed(4)}
                            </div>
                            <a
                              href={`https://www.gbif.org/occurrence/${feature.properties.gbifID}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-1 inline-block"
                            >
                              View on GBIF →
                            </a>
                          </div>
                        </Popup>
                      </CircleMarker>
                    );
                  })}
                </MapContainer>
              ) : null}
              {!loadingOccurrences && (
                <div className="absolute bottom-2 left-2 z-[1000] bg-white dark:bg-zinc-800 px-2 py-1.5 rounded text-xs text-zinc-600 dark:text-zinc-300 shadow flex items-center gap-3">
                  {/* Legend */}
                  {assessmentYear ? (
                    <>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full bg-gray-400 border-2 border-gray-500" />
                        <span>≤{assessmentYear} ({oldRecords.length})</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-green-700" />
                        <span>New since {assessmentYear} ({newRecords.length})</span>
                      </div>
                      {showPreservedSpecimens && preservedRecords.length > 0 && (
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-amber-500 border-2 border-amber-700" />
                          <span>Preserved ({preservedRecords.length})</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <span>
                      {totalOccurrences && totalOccurrences > occurrences.length
                        ? `${filteredOccurrences.length} of ${totalOccurrences.toLocaleString()} occurrences`
                        : `${filteredOccurrences.length} occurrences`}
                    </span>
                  )}
                </div>
              )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
