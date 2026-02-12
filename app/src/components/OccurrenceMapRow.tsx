"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

// Hook to get responsive grid column count: 3 (mobile portrait), 5 (landscape/sm+)
function useGridColumns() {
  const [cols, setCols] = useState(5);
  useEffect(() => {
    const smQuery = window.matchMedia("(min-width: 640px)");
    const update = () => setCols(smQuery.matches ? 5 : 3);
    update();
    smQuery.addEventListener("change", update);
    return () => smQuery.removeEventListener("change", update);
  }, []);
  return cols;
}

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
const HoverPreviewOverlay = dynamic(
  () => import("./HoverPreviewOverlay"),
  { ssr: false }
);
const FitBounds = dynamic(
  () => import("./FitBounds"),
  { ssr: false }
);

const INAT_DATASET_KEY = "50c9509d-22c7-4a22-a47d-8c48425ef4a7";

interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: number;
    species: string;
    eventDate?: string;
    basisOfRecord?: string;
    datasetKey?: string;
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
  mediaType?: "StillImage" | "Sound" | "MovingImage" | null;
  audioUrl?: string | null;
  gbifID?: number | null;
  decimalLatitude?: number | null;
  decimalLongitude?: number | null;
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
  assessmentYear?: number | null;
}

// Convert iNaturalist photo URLs to a smaller size for thumbnails
// e.g. .../photos/123/original.jpeg -> .../photos/123/small.jpeg (240px)
function getThumbUrl(url: string): string {
  return url.replace(/\/original\./, '/small.');
}

// Audio player card for sound-only observations
function InatAudioCard({ obs, idx, onHover, onLeave }: { obs: InatObservation; idx: number; onHover?: () => void; onLeave?: () => void }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      audio.play();
    }
  };

  return (
    <div
      className="aspect-[3/4] sm:aspect-square relative group"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <a
        href={obs.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block w-full h-full"
      >
        <div className="w-full h-full bg-gradient-to-br from-emerald-50 to-teal-100 dark:from-emerald-950 dark:to-teal-900 rounded ring-1 ring-emerald-200 dark:ring-emerald-800 flex flex-col items-center justify-center gap-1 p-2 transition-all group-hover:ring-2 group-hover:ring-emerald-400 dark:group-hover:ring-emerald-600">
          {/* Waveform-style icon */}
          <div className="flex items-end gap-[2px] h-6 mb-0.5">
            {[40, 70, 55, 85, 45, 75, 50].map((h, i) => (
              <div
                key={i}
                className={`w-[3px] rounded-full ${playing ? 'animate-pulse' : ''}`}
                style={{
                  height: `${h}%`,
                  backgroundColor: playing ? '#10b981' : '#6ee7b7',
                  animationDelay: `${i * 0.1}s`,
                }}
              />
            ))}
          </div>
          {obs.date && (
            <div className="text-[10px] text-emerald-600 dark:text-emerald-400 truncate max-w-full">{obs.date}</div>
          )}
        </div>
      </a>
      {obs.audioUrl && (
        <>
          <audio
            ref={audioRef}
            preload="none"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            aria-label={`Audio observation ${idx + 1}`}
          >
            <source src={obs.audioUrl} />
          </audio>
          <button
            onClick={togglePlay}
            className="absolute bottom-1.5 right-1.5 w-6 h-6 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-sm transition-colors"
            title={playing ? "Pause" : "Play audio"}
          >
            {playing ? (
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
              </svg>
            ) : (
              <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            )}
          </button>
        </>
      )}
    </div>
  );
}

// iNat photo thumbnail (hover triggers map highlight via onHover/onLeave)
function InatPhotoWithPreview({ obs, idx, onHover, onLeave }: { obs: InatObservation; idx: number; onHover?: () => void; onLeave?: () => void }) {
  // If this is an audio-only observation (no image), render the audio card
  if (!obs.imageUrl && obs.audioUrl) {
    return <InatAudioCard obs={obs} idx={idx} onHover={onHover} onLeave={onLeave} />;
  }

  const [isHovered, setIsHovered] = useState(false);
  const hasAudio = !!obs.audioUrl;

  return (
    <div
      className="aspect-[3/4] sm:aspect-square relative"
      onMouseEnter={() => { setIsHovered(true); onHover?.(); }}
      onMouseLeave={() => { setIsHovered(false); onLeave?.(); }}
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
      {/* Audio badge for observations that have both image and audio */}
      {hasAudio && obs.imageUrl && (
        <div className="absolute bottom-1 right-1 bg-black/60 rounded-full p-1" title="Has audio">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
          </svg>
        </div>
      )}
    </div>
  );
}

export default function OccurrenceMapRow({
  speciesKey,
  countryCode,
  mounted,
  assessmentYear,
}: OccurrenceMapRowProps) {
  const [occurrences, setOccurrences] = useState<OccurrenceFeature[]>([]);
  const [breakdown, setBreakdown] = useState<RecordTypeBreakdown | null>(null);
  const [loadingOccurrences, setLoadingOccurrences] = useState(true);
  const [loadingBreakdown, setLoadingBreakdown] = useState(true);

  // Checkbox state for each observation type category (default: all checked except preserved & other)
  const [checkedTypes, setCheckedTypes] = useState({
    iNaturalist: true,
    humanOther: true,
    machineObservation: true,
    preservedSpecimen: false,
    other: false,
  });

  // Responsive grid columns and page size (always 2 rows)
  const gridCols = useGridColumns();
  const pageSize = gridCols * 2;

  // iNat photos pagination
  const [inatPage, setInatPage] = useState(0);
  const [inatPhotos, setInatPhotos] = useState<InatObservation[]>([]);
  const [inatTotalCount, setInatTotalCount] = useState(0);
  const [loadingInatPhotos, setLoadingInatPhotos] = useState(false);

  // Hovered iNat observation (for map highlight)
  const [hoveredObs, setHoveredObs] = useState<InatObservation | null>(null);

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
      .then((data) => {
        setBreakdown(data);
        setInatTotalCount(data.inatTotalCount || data.iNaturalist || 0);
      })
      .catch(console.error)
      .finally(() => setLoadingBreakdown(false));
  }, [speciesKey, countryCode]);

  // Fetch iNat photos for a given page
  const fetchInatPhotos = useCallback((page: number, limit: number) => {
    setLoadingInatPhotos(true);
    const params = new URLSearchParams({
      offset: (page * limit).toString(),
      limit: limit.toString(),
    });
    if (countryCode) {
      params.set("country", countryCode);
    }
    fetch(`/api/species/${speciesKey}/inat-photos?${params}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.observations) {
          setInatPhotos(data.observations);
          if (data.totalCount) setInatTotalCount(data.totalCount);
        }
      })
      .catch(console.error)
      .finally(() => setLoadingInatPhotos(false));
  }, [speciesKey, countryCode]);

  // Re-fetch when screen size changes (page size changes)
  useEffect(() => {
    // Reset to page 0 and re-fetch with new page size
    setInatPage(0);
    fetchInatPhotos(0, pageSize);
  }, [pageSize, fetchInatPhotos]);

  // Helper to check if a record is a preserved specimen or material sample
  const isPreserved = (basisOfRecord?: string): boolean => {
    return basisOfRecord === "PRESERVED_SPECIMEN" || basisOfRecord === "MATERIAL_SAMPLE";
  };

  // Classify an occurrence into one of the 5 checkbox categories
  const getCategory = (o: OccurrenceFeature): keyof typeof checkedTypes => {
    const basis = o.properties.basisOfRecord;
    if (basis === "HUMAN_OBSERVATION") {
      return o.properties.datasetKey === INAT_DATASET_KEY ? "iNaturalist" : "humanOther";
    }
    if (basis === "MACHINE_OBSERVATION") return "machineObservation";
    if (isPreserved(basis)) return "preservedSpecimen";
    return "other";
  };

  // Filter occurrences based on which checkboxes are ticked
  const filteredOccurrences = occurrences.filter((o) => checkedTypes[getCategory(o)]);

  // Derive showPreservedSpecimens from checkbox state (for map legend)
  const showPreservedSpecimens = checkedTypes.preservedSpecimen;

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
        <div
          className="bg-zinc-50 dark:bg-zinc-800/50"
        >
          <div className="p-2">
            {/* Main layout: 1/3 left (breakdown + photos), 2/3 right (map) */}
            <div className="flex flex-col lg:flex-row gap-3">
              {/* Left column: Breakdown + iNat photos (1/3 width) */}
              <div className="lg:w-1/3 flex flex-col gap-3 relative z-10">
                {/* Observation type breakdown */}
                <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700">
                  <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2">Observation Types</div>
                  {loadingBreakdown ? (
                    <div className="flex items-center gap-2 text-zinc-400 text-sm py-1">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Loading...
                    </div>
                  ) : breakdown ? (() => {
                    const baseParams = `taxon_key=${speciesKey}&has_coordinate=true&has_geospatial_issue=false${countryCode ? `&country=${countryCode}` : ''}`;
                    const humanOtherCount = Math.max(0, breakdown.humanObservation - breakdown.iNaturalist);

                    // Calculate total from checked types only
                    const checkedTotal =
                      (checkedTypes.iNaturalist ? breakdown.iNaturalist : 0) +
                      (checkedTypes.humanOther ? humanOtherCount : 0) +
                      (checkedTypes.machineObservation ? breakdown.machineObservation : 0) +
                      (checkedTypes.preservedSpecimen ? breakdown.preservedSpecimen : 0) +
                      (checkedTypes.other ? breakdown.other : 0);

                    const toggleType = (key: keyof typeof checkedTypes) => {
                      setCheckedTypes((prev) => ({ ...prev, [key]: !prev[key] }));
                    };

                    const rowClass = (checked: boolean) =>
                      `flex items-center gap-2 transition-opacity ${checked ? '' : 'opacity-40'}`;

                    return (
                    <div className="space-y-1.5 text-sm">
                      {/* Human Observations (iNaturalist) */}
                      <div className={rowClass(checkedTypes.iNaturalist)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.iNaturalist}
                          onChange={() => toggleType('iNaturalist')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&dataset_key=50c9509d-22c7-4a22-a47d-8c48425ef4a7`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Human Observations (iNaturalist)</span>
                          <span className="tabular-nums">{breakdown.iNaturalist.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Human Observations (other) */}
                      <div className={rowClass(checkedTypes.humanOther)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.humanOther}
                          onChange={() => toggleType('humanOther')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=HUMAN_OBSERVATION`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Human Observations (other)</span>
                          <span className="tabular-nums">{humanOtherCount.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Machine Observations */}
                      <div className={rowClass(checkedTypes.machineObservation)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.machineObservation}
                          onChange={() => toggleType('machineObservation')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=MACHINE_OBSERVATION`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Machine Observations</span>
                          <span className="tabular-nums">{breakdown.machineObservation.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Preserved Specimens / Material Samples */}
                      <div className={rowClass(checkedTypes.preservedSpecimen)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.preservedSpecimen}
                          onChange={() => toggleType('preservedSpecimen')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <a
                          href={`https://www.gbif.org/occurrence/search?${baseParams}&basis_of_record=PRESERVED_SPECIMEN`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
                        >
                          <span>Preserved Specimens / Material Samples</span>
                          <span className="tabular-nums">{breakdown.preservedSpecimen.toLocaleString()}</span>
                        </a>
                      </div>

                      {/* Other */}
                      <div className={rowClass(checkedTypes.other)}>
                        <input
                          type="checkbox"
                          checked={checkedTypes.other}
                          onChange={() => toggleType('other')}
                          className="w-3.5 h-3.5 rounded accent-blue-500 shrink-0"
                        />
                        <div className="flex justify-between flex-1 text-zinc-600 dark:text-zinc-400">
                          <span>Other</span>
                          <span className="tabular-nums">{breakdown.other.toLocaleString()}</span>
                        </div>
                      </div>

                      {/* Total (of checked types) */}
                      <div className="border-t border-zinc-200 dark:border-zinc-700 pt-1 mt-1 flex justify-between font-medium text-zinc-700 dark:text-zinc-300">
                        <span>Total</span>
                        <span className="tabular-nums">{checkedTotal.toLocaleString()}</span>
                      </div>
                    </div>
                    );
                  })() : null}
                </div>

                {/* iNaturalist photos grid with pagination */}
                {inatPhotos.length > 0 && (
                  <div className="p-3 bg-white dark:bg-zinc-900 rounded-lg border border-zinc-200 dark:border-zinc-700 flex-1 overflow-hidden">
                    <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-2 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span>iNaturalist</span>
                        <span className="text-zinc-400 text-xs">({inatTotalCount.toLocaleString()} total)</span>
                      </div>
                      {/* Pagination controls */}
                      {inatTotalCount > pageSize && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => {
                              const newPage = inatPage - 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={inatPage === 0 || loadingInatPhotos}
                            className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            ‹ Prev
                          </button>
                          <span className="text-xs text-zinc-400 tabular-nums">
                            {inatPage + 1} / {Math.ceil(inatTotalCount / pageSize)}
                          </span>
                          <button
                            onClick={() => {
                              const newPage = inatPage + 1;
                              setInatPage(newPage);
                              fetchInatPhotos(newPage, pageSize);
                            }}
                            disabled={(inatPage + 1) * pageSize >= inatTotalCount || loadingInatPhotos}
                            className="px-1.5 py-0.5 text-xs rounded border border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          >
                            Next ›
                          </button>
                        </div>
                      )}
                    </div>
                    <div className={`grid grid-cols-3 sm:grid-cols-5 gap-1.5 ${loadingInatPhotos ? 'opacity-50' : ''}`}>
                      {inatPhotos.slice(0, pageSize).map((obs, idx) => (
                        <InatPhotoWithPreview
                          key={`${inatPage}-${idx}`}
                          obs={obs}
                          idx={idx}
                          onHover={() => setHoveredObs(obs)}
                          onLeave={() => setHoveredObs(null)}
                        />
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
                  <div className="flex items-center gap-2 text-zinc-400 text-sm">
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Loading occurrences...
                  </div>
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
                    const isHighlighted = hoveredObs?.gbifID != null && feature.properties.gbifID === hoveredObs.gbifID;
                    // Color: highlighted=blue, preserved=amber, new=green, old=grey
                    const strokeColor = isHighlighted ? "#1d4ed8" : preserved ? "#b45309" : isNew ? "#15803d" : "#6b7280";
                    const fillColor = isHighlighted ? "#3b82f6" : preserved ? "#f59e0b" : isNew ? "#22c55e" : "#9ca3af";
                    return (
                      <CircleMarker
                        key={feature.properties.gbifID || idx}
                        center={[lat, lon]}
                        radius={isHighlighted ? 9 : 5}
                        pathOptions={{
                          color: strokeColor,
                          fillColor: fillColor,
                          fillOpacity: isHighlighted ? 1 : 0.9,
                          weight: isHighlighted ? 3 : 2,
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
                  {/* Highlighted observation marker (blue ring) */}
                  {hoveredObs && hoveredObs.decimalLatitude != null && hoveredObs.decimalLongitude != null && (
                    <CircleMarker
                      center={[hoveredObs.decimalLatitude, hoveredObs.decimalLongitude]}
                      radius={12}
                      pathOptions={{
                        color: "#1d4ed8",
                        fillColor: "#3b82f6",
                        fillOpacity: 0.3,
                        weight: 3,
                      }}
                    />
                  )}
                  {/* Image/audio preview rendered as a portal so it is not clipped by the map container */}
                  <HoverPreviewOverlay hoveredObs={hoveredObs} />
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
  );
}
