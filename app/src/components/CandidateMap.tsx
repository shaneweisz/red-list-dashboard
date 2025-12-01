"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

interface CandidateFeature {
  type: "Feature";
  properties: {
    probability: number;
    model_type: string;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

interface CandidatesResponse {
  type: "FeatureCollection";
  features: CandidateFeature[];
  metadata?: {
    bbox: number[];
    species: string;
    filtered_count: number;
    probability_threshold: number;
  };
}

interface CandidateMapProps {
  species?: string;
  minProbability?: number;
}

// Dynamically import the map components to avoid SSR issues with Leaflet
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

// Color scale from red (low prob) through yellow to green (high prob)
function getProbabilityColor(probability: number): string {
  if (probability < 0.5) {
    // Red to Yellow
    const ratio = probability * 2;
    const r = 255;
    const g = Math.round(255 * ratio);
    return `rgb(${r}, ${g}, 50)`;
  } else {
    // Yellow to Green
    const ratio = (probability - 0.5) * 2;
    const r = Math.round(255 * (1 - ratio));
    const g = 255;
    return `rgb(${r}, ${g}, 50)`;
  }
}

export default function CandidateMap({ species = "oak", minProbability = 0.6 }: CandidateMapProps) {
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchCandidates() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/candidates?species=${encodeURIComponent(species)}&minProb=${minProbability}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch candidates: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        setCandidates(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchCandidates();
  }, [species, minProbability]);

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 flex items-center justify-center h-96">
        <div className="text-zinc-400">Loading candidate locations...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 h-96">
        <div className="text-red-400 mb-2">Error loading candidates</div>
        <div className="text-zinc-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!candidates || candidates.features.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 flex items-center justify-center h-96">
        <div className="text-zinc-400">No candidate locations found for {species}</div>
      </div>
    );
  }

  // Calculate center from bbox or features
  let minLon = Infinity, maxLon = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;

  if (candidates.metadata?.bbox) {
    [minLon, minLat, maxLon, maxLat] = candidates.metadata.bbox;
  } else {
    for (const feature of candidates.features) {
      const [lon, lat] = feature.geometry.coordinates;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }

  const center: [number, number] = [
    (minLat + maxLat) / 2,
    (minLon + maxLon) / 2,
  ];

  return (
    <div className="bg-zinc-900 rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">
          Candidate Locations: {species}
        </h2>
        <div className="text-sm text-zinc-400">
          {candidates.features.length} locations (prob &ge; {minProbability})
        </div>
      </div>

      <div className="relative h-[400px] rounded-lg overflow-hidden border border-zinc-700">
        {mounted && (
          <MapContainer
            center={center}
            zoom={11}
            style={{ height: "100%", width: "100%" }}
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {candidates.features.map((feature, idx) => {
              const [lon, lat] = feature.geometry.coordinates;
              const prob = feature.properties.probability;
              const color = getProbabilityColor(prob);
              return (
                <CircleMarker
                  key={idx}
                  center={[lat, lon]}
                  radius={4 + prob * 4}
                  pathOptions={{
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.7,
                    weight: 1,
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-medium">Probability: {(prob * 100).toFixed(1)}%</div>
                      <div className="text-xs text-gray-500">
                        {lat.toFixed(4)}, {lon.toFixed(4)}
                      </div>
                    </div>
                  </Popup>
                </CircleMarker>
              );
            })}
          </MapContainer>
        )}
      </div>

      {candidates.metadata && (
        <div className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div className="bg-zinc-800 rounded p-3">
            <div className="text-zinc-400">Threshold</div>
            <div className="text-zinc-100 font-medium">
              {candidates.metadata.probability_threshold || minProbability}
            </div>
          </div>
          <div className="bg-zinc-800 rounded p-3">
            <div className="text-zinc-400">Candidates Found</div>
            <div className="text-zinc-100 font-medium">
              {candidates.metadata.filtered_count || candidates.features.length}
            </div>
          </div>
          <div className="bg-zinc-800 rounded p-3">
            <div className="text-zinc-400">Species</div>
            <div className="text-zinc-100 font-medium italic">
              {candidates.metadata.species || species}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-red-400" />
          <span className="text-xs text-zinc-400">Low probability</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-yellow-400" />
          <span className="text-xs text-zinc-400">Medium</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded-full bg-green-400" />
          <span className="text-xs text-zinc-400">High probability</span>
        </div>
      </div>
    </div>
  );
}
