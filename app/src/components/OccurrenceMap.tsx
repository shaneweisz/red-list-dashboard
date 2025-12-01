"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

interface OccurrenceFeature {
  type: "Feature";
  properties: {
    gbifID: string;
    species: string;
    eventDate?: string;
    recordedBy?: string;
  };
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
}

interface OccurrencesResponse {
  type: "FeatureCollection";
  features: OccurrenceFeature[];
  metadata?: {
    bbox: number[];
    species: string;
    count: number;
  };
}

interface OccurrenceMapProps {
  species?: string;
}

// Dynamically import the map component to avoid SSR issues with Leaflet
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

export default function OccurrenceMap({ species = "quercus_robur" }: OccurrenceMapProps) {
  const [occurrences, setOccurrences] = useState<OccurrencesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    async function fetchOccurrences() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/occurrences?species=${encodeURIComponent(species)}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch occurrences: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.error) {
          throw new Error(data.error);
        }

        setOccurrences(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchOccurrences();
  }, [species]);

  if (loading) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 flex items-center justify-center h-96">
        <div className="text-zinc-400">Loading GBIF occurrences...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 h-96">
        <div className="text-red-400 mb-2">Error loading occurrences</div>
        <div className="text-zinc-500 text-sm">{error}</div>
      </div>
    );
  }

  if (!occurrences || occurrences.features.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-xl p-6 flex items-center justify-center h-96">
        <div className="text-zinc-400">No occurrences found for {species}</div>
      </div>
    );
  }

  // Calculate center and bounds
  const bbox = occurrences.metadata?.bbox || [0, 52, 0.2, 52.3];
  const center: [number, number] = [
    (bbox[1] + bbox[3]) / 2,
    (bbox[0] + bbox[2]) / 2,
  ];

  return (
    <div className="bg-zinc-900 rounded-xl p-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-zinc-100">
          GBIF Occurrences: <span className="italic">{occurrences.metadata?.species || species}</span>
        </h2>
        <div className="text-sm text-zinc-400">
          {occurrences.features.length} records
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
            {occurrences.features.map((feature, idx) => {
              const [lon, lat] = feature.geometry.coordinates;
              return (
                <CircleMarker
                  key={feature.properties.gbifID || idx}
                  center={[lat, lon]}
                  radius={6}
                  pathOptions={{
                    color: "#3b82f6",
                    fillColor: "#3b82f6",
                    fillOpacity: 0.7,
                    weight: 1,
                  }}
                >
                  <Popup>
                    <div className="text-sm">
                      <div className="font-medium italic">{feature.properties.species}</div>
                      {feature.properties.eventDate && (
                        <div>Date: {feature.properties.eventDate}</div>
                      )}
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

      <div className="mt-4 flex items-center gap-2">
        <div className="w-4 h-4 rounded-full bg-blue-500" />
        <span className="text-xs text-zinc-400">GBIF occurrence record</span>
      </div>
    </div>
  );
}
