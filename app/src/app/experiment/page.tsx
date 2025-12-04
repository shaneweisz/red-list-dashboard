"use client";

import React, { useState, useEffect } from "react";
import dynamic from "next/dynamic";

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
const Rectangle = dynamic(
  () => import("react-leaflet").then((mod) => mod.Rectangle),
  { ssr: false }
);
const Marker = dynamic(
  () => import("react-leaflet").then((mod) => mod.Marker),
  { ssr: false }
);

interface Point {
  lon: number;
  lat: number;
  score?: number;
  confidence?: number;
  uncertainty?: number;
}

interface Trial {
  seed: number;
  auc: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
  mean_positive: number;
  mean_negative: number;
  n_test_positive: number;
  n_test_negative: number;
  train_positive: { lon: number; lat: number }[];
  train_negative: { lon: number; lat: number }[];
  test_positive: Point[];
  test_negative: Point[];
}

interface Experiment {
  n_positive: number;
  n_negative: number;
  n_trials: number;
  auc_mean: number;
  auc_std: number;
  f1_mean: number;
  f1_std: number;
  precision_mean: number;
  precision_std: number;
  recall_mean: number;
  recall_std: number;
  trials: Trial[];
}

interface SpeciesData {
  species: string;
  species_key: number;
  region: string;
  model_type?: string;
  n_occurrences: number;
  n_trials: number;
  experiments: Experiment[];
}

type ExperimentModelType = "logistic" | "mlp";

interface SpeciesNames {
  [key: string]: string | undefined; // species_key -> vernacular name
}

interface LocalPrediction {
  lon: number;
  lat: number;
  score: number;
  uncertainty?: number;
  confidence?: number;
}

interface LocalPredictionResult {
  predictions: LocalPrediction[];
  species: string;
  species_key: number;
  model_type: "logistic" | "mlp";
  has_uncertainty: boolean;
  center: { lon: number; lat: number };
  grid_size_m: number;
  n_pixels: number;
}

type ModelType = "logistic" | "mlp";

const SPECIES_FILES = [
  "quercus_robur",
  "fraxinus_excelsior",
  "urtica_dioica",
];

export default function ExperimentPage() {
  const [speciesDataByModel, setSpeciesDataByModel] = useState<Record<ExperimentModelType, Record<string, SpeciesData>>>({
    logistic: {},
    mlp: {},
  });
  const [speciesNames, setSpeciesNames] = useState<SpeciesNames>({});
  const [selectedSpecies, setSelectedSpecies] = useState<string>("quercus_robur");
  const [selectedNPositive, setSelectedNPositive] = useState<number>(50);
  const [selectedTrialIdx, setSelectedTrialIdx] = useState<number>(0);
  const [threshold, setThreshold] = useState<number>(0.5);
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [experimentModelType, setExperimentModelType] = useState<ExperimentModelType>("mlp");

  // Location-based prediction state
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [localPredictions, setLocalPredictions] = useState<LocalPredictionResult | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showConfidence, setShowConfidence] = useState(false);
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [modelType, setModelType] = useState<ModelType>("mlp");

  useEffect(() => {
    setMounted(true);
    // Load experiment data for both model types
    const loadModelData = async (modelType: ExperimentModelType) => {
      const results = await Promise.all(
        SPECIES_FILES.map(async (slug) => {
          try {
            const res = await fetch(`/experiments/${modelType}/${slug}.json`);
            if (res.ok) {
              const data = await res.json();
              return [slug, data] as [string, SpeciesData];
            }
          } catch (e) {
            console.error(`Failed to load ${modelType}/${slug}:`, e);
          }
          return null;
        })
      );
      const data: Record<string, SpeciesData> = {};
      results.forEach((r) => {
        if (r) data[r[0]] = r[1];
      });
      return data;
    };

    Promise.all([
      loadModelData("logistic"),
      loadModelData("mlp"),
    ]).then(([logisticData, mlpData]) => {
      setSpeciesDataByModel({
        logistic: logisticData,
        mlp: mlpData,
      });
      setLoading(false);

      // Fetch vernacular names for all species (use logistic data for keys)
      const speciesKeys = Object.values(logisticData).map((d) => d.species_key);
      Promise.all(
        speciesKeys.map(async (key) => {
          try {
            const res = await fetch(`/api/species/${key}`);
            if (res.ok) {
              const info = await res.json();
              return [key.toString(), info.vernacularName] as [string, string | undefined];
            }
          } catch (e) {
            console.error(`Failed to fetch species ${key}:`, e);
          }
          return [key.toString(), undefined] as [string, string | undefined];
        })
      ).then((nameResults) => {
        const names: SpeciesNames = {};
        nameResults.forEach(([key, name]) => {
          names[key] = name;
        });
        setSpeciesNames(names);
      });
    });
  }, []);

  const speciesData = speciesDataByModel[experimentModelType];
  const currentData = speciesData[selectedSpecies];
  const currentExp = currentData?.experiments.find((e) => e.n_positive === selectedNPositive);
  const availableNPositive = currentData?.experiments.map((e) => e.n_positive) || [];
  const currentTrial = currentExp?.trials[selectedTrialIdx];

  // Get comparison data from the other model
  const otherModelType: ExperimentModelType = experimentModelType === "logistic" ? "mlp" : "logistic";
  const otherModelData = speciesDataByModel[otherModelType][selectedSpecies];
  const otherModelExp = otherModelData?.experiments.find((e) => e.n_positive === selectedNPositive);

  // Ensure selectedNPositive is valid for current species
  useEffect(() => {
    if (availableNPositive.length > 0 && !availableNPositive.includes(selectedNPositive)) {
      setSelectedNPositive(availableNPositive[0]);
    }
  }, [availableNPositive, selectedNPositive]);

  // Reset trial index when n changes
  useEffect(() => {
    setSelectedTrialIdx(0);
  }, [selectedNPositive]);

  // Clear local predictions when species changes
  useEffect(() => {
    setLocalPredictions(null);
    setLocalError(null);
  }, [selectedSpecies]);

  // Get user location and fetch predictions
  const handleFindMe = async () => {
    if (!currentData) return;

    setLocalLoading(true);
    setLocalError(null);

    try {
      // Get user's location
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
        });
      });

      const { latitude: lat, longitude: lon } = position.coords;
      setUserLocation({ lat, lon });

      // Fetch predictions for this location (500m x 500m grid)
      const res = await fetch(
        `/api/predict-local?lat=${lat}&lon=${lon}&speciesKey=${currentData.species_key}&gridSize=500&modelType=${modelType}`
      );

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to get predictions");
      }

      const result = await res.json();
      setLocalPredictions(result);
    } catch (err) {
      if (err instanceof GeolocationPositionError) {
        setLocalError("Could not get your location. Please enable location access.");
      } else {
        setLocalError(err instanceof Error ? err.message : "Failed to get predictions");
      }
    } finally {
      setLocalLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">Loading experiment data...</div>
      </div>
    );
  }

  if (!currentData || !currentExp || !currentTrial) {
    return (
      <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 flex items-center justify-center">
        <div className="text-zinc-500">No experiment data found</div>
      </div>
    );
  }

  // Compute confusion matrix based on threshold
  const getScore = (pt: Point) => pt.score ?? 0;

  const truePositives = currentTrial.test_positive.filter(pt => getScore(pt) >= threshold);
  const falseNegatives = currentTrial.test_positive.filter(pt => getScore(pt) < threshold);
  const trueNegatives = currentTrial.test_negative.filter(pt => getScore(pt) < threshold);
  const falsePositives = currentTrial.test_negative.filter(pt => getScore(pt) >= threshold);

  const tp = truePositives.length;
  const fn = falseNegatives.length;
  const tn = trueNegatives.length;
  const fp = falsePositives.length;

  const accuracy = (tp + tn) / (tp + tn + fp + fn);
  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950 p-4 md:p-8">
      <main className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
            Tree Species Classification in Cambridge
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Validating classifier performance on held-out occurrences vs random background points
            <span className="ml-1 text-zinc-500">({currentData.n_trials} trials per setting)</span>
          </p>
        </div>

        {/* Species selector - full width */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 mb-6">
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Species
            </label>
            <select
              value={selectedSpecies}
              onChange={(e) => setSelectedSpecies(e.target.value)}
              className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100"
            >
              {Object.entries(speciesData).map(([slug, data]) => {
                const vernacularName = speciesNames[data.species_key.toString()];
                return (
                  <option key={slug} value={slug}>
                    {data.species}
                    {vernacularName ? ` (${vernacularName})` : ""} - {data.n_occurrences} occurrences
                  </option>
                );
              })}
            </select>
            <a
              href={`https://www.gbif.org/species/${currentData.species_key}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-green-600 hover:text-green-700 hover:underline"
            >
              View on GBIF →
            </a>
          </div>
        </div>

        {/* Controls row */}
        <div className="flex flex-wrap items-center gap-4 mb-4 bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
          {/* Model type selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Model</label>
            <div className="flex rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
              <button
                onClick={() => setExperimentModelType("logistic")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  experimentModelType === "logistic"
                    ? "bg-green-600 text-white"
                    : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                }`}
              >
                Logistic
              </button>
              <button
                onClick={() => setExperimentModelType("mlp")}
                className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-zinc-200 dark:border-zinc-700 ${
                  experimentModelType === "mlp"
                    ? "bg-purple-600 text-white"
                    : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                }`}
              >
                MLP
              </button>
            </div>
          </div>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700" />

          {/* N selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">Training samples</label>
            <div className="flex flex-wrap gap-1">
              {availableNPositive.map((n) => (
                <button
                  key={n}
                  onClick={() => setSelectedNPositive(n)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    selectedNPositive === n
                      ? "bg-green-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="h-6 w-px bg-zinc-200 dark:bg-zinc-700" />

          {/* Trial selector */}
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Trial <span className="font-normal text-zinc-500">(seed: {currentTrial.seed})</span>
            </label>
            <div className="flex flex-wrap gap-1">
              {currentExp.trials.map((trial, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedTrialIdx(idx)}
                  className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                    selectedTrialIdx === idx
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300"
                  }`}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Map with metrics sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4 mb-6">
          {/* Map */}
          <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
            <div className="p-2 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-yellow-500 border border-yellow-700" />
                  <span className="text-zinc-600 dark:text-zinc-400">Train+</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-500 border border-purple-700" />
                  <span className="text-zinc-600 dark:text-zinc-400">Train−</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 border border-green-700" />
                  <span className="text-zinc-600 dark:text-zinc-400">TP</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500 border border-orange-700" />
                  <span className="text-zinc-600 dark:text-zinc-400">FN</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500 border border-red-700" />
                  <span className="text-zinc-600 dark:text-zinc-400">FP</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2.5 h-2.5 rounded-full bg-zinc-400 border border-zinc-600" />
                  <span className="text-zinc-600 dark:text-zinc-400">TN</span>
                </div>
              </div>
            </div>
            <div className="h-[500px]">
            {mounted && (
              <MapContainer
                center={[52.205, 0.1235]}
                zoom={11}
                style={{ height: "100%", width: "100%" }}
              >
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                {/* True Negatives (correctly classified negatives) - grey */}
                {trueNegatives.map((pt, idx) => {
                  const score = getScore(pt);
                  return (
                    <CircleMarker
                      key={`tn-${idx}`}
                      center={[pt.lat, pt.lon]}
                      radius={5}
                      pathOptions={{
                        color: "#52525b",
                        fillColor: "#a1a1aa",
                        fillOpacity: 0.6,
                        weight: 1,
                      }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <div className="font-medium text-zinc-600">True Negative (TN)</div>
                          <div>Score: {score.toFixed(3)}</div>
                          {experimentModelType === "mlp" && pt.confidence !== undefined && (
                            <div className="text-purple-600">Confidence: {(pt.confidence * 100).toFixed(0)}%</div>
                          )}
                          <div className="text-xs text-zinc-500">Correctly rejected</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {/* False Positives (incorrectly predicted as positive) - red */}
                {falsePositives.map((pt, idx) => {
                  const score = getScore(pt);
                  return (
                    <CircleMarker
                      key={`fp-${idx}`}
                      center={[pt.lat, pt.lon]}
                      radius={6}
                      pathOptions={{
                        color: "#b91c1c",
                        fillColor: "#ef4444",
                        fillOpacity: 0.8,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <div className="font-medium text-red-600">False Positive (FP)</div>
                          <div>Score: {score.toFixed(3)}</div>
                          {experimentModelType === "mlp" && pt.confidence !== undefined && (
                            <div className="text-purple-600">Confidence: {(pt.confidence * 100).toFixed(0)}%</div>
                          )}
                          <div className="text-xs text-zinc-500">Incorrectly predicted</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {/* False Negatives (missed real occurrences) - orange */}
                {falseNegatives.map((pt, idx) => {
                  const score = getScore(pt);
                  return (
                    <CircleMarker
                      key={`fn-${idx}`}
                      center={[pt.lat, pt.lon]}
                      radius={6}
                      pathOptions={{
                        color: "#c2410c",
                        fillColor: "#f97316",
                        fillOpacity: 0.8,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <div className="font-medium text-orange-600">False Negative (FN)</div>
                          <div>Score: {score.toFixed(3)}</div>
                          {experimentModelType === "mlp" && pt.confidence !== undefined && (
                            <div className="text-purple-600">Confidence: {(pt.confidence * 100).toFixed(0)}%</div>
                          )}
                          <div className="text-xs text-zinc-500">Missed occurrence</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {/* True Positives (correctly identified occurrences) - green */}
                {truePositives.map((pt, idx) => {
                  const score = getScore(pt);
                  return (
                    <CircleMarker
                      key={`tp-${idx}`}
                      center={[pt.lat, pt.lon]}
                      radius={6}
                      pathOptions={{
                        color: "#15803d",
                        fillColor: "#22c55e",
                        fillOpacity: 0.8,
                        weight: 2,
                      }}
                    >
                      <Popup>
                        <div className="text-sm">
                          <div className="font-medium text-green-600">True Positive (TP)</div>
                          <div>Score: {score.toFixed(3)}</div>
                          {experimentModelType === "mlp" && pt.confidence !== undefined && (
                            <div className="text-purple-600">Confidence: {(pt.confidence * 100).toFixed(0)}%</div>
                          )}
                          <div className="text-xs text-zinc-500">Correctly identified</div>
                        </div>
                      </Popup>
                    </CircleMarker>
                  );
                })}
                {/* Training negative points - purple */}
                {currentTrial.train_negative.map((pt, idx) => (
                  <CircleMarker
                    key={`train-neg-${idx}`}
                    center={[pt.lat, pt.lon]}
                    radius={7}
                    pathOptions={{
                      color: "#7e22ce",
                      fillColor: "#a855f7",
                      fillOpacity: 0.9,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <div className="font-medium text-purple-600">Training Negative</div>
                        <div className="text-xs text-zinc-500">Background sample</div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}
                {/* Training positive points (on top) - yellow */}
                {currentTrial.train_positive.map((pt, idx) => (
                  <CircleMarker
                    key={`train-pos-${idx}`}
                    center={[pt.lat, pt.lon]}
                    radius={7}
                    pathOptions={{
                      color: "#a16207",
                      fillColor: "#eab308",
                      fillOpacity: 0.9,
                      weight: 2,
                    }}
                  >
                    <Popup>
                      <div className="text-sm">
                        <div className="font-medium text-yellow-600">Training Positive</div>
                        <div className="text-xs text-zinc-500">Known occurrence</div>
                      </div>
                    </Popup>
                  </CircleMarker>
                ))}

              </MapContainer>
            )}
            </div>
          </div>

          {/* Right sidebar - Metrics */}
          <div className="space-y-4">
            {/* AUC */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 text-center">
              <div className={`text-3xl font-bold ${currentExp.auc_mean >= 0.7 ? "text-green-600" : currentExp.auc_mean >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                {(currentExp.auc_mean * 100).toFixed(1)}%
              </div>
              <div className="text-xs text-zinc-400">± {(currentExp.auc_std * 100).toFixed(1)}</div>
              <div className="text-sm text-zinc-500">AUC</div>
            </div>

            {/* F1 */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 text-center">
              <div className={`text-3xl font-bold ${f1 >= 0.7 ? "text-green-600" : f1 >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                {(f1 * 100).toFixed(1)}%
              </div>
              <div className="text-sm text-zinc-500">F1 Score</div>
            </div>

            {/* Threshold + Confusion matrix */}
            <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  Decision Threshold
                </h3>
                <span className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  {threshold.toFixed(2)}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={threshold}
                onChange={(e) => setThreshold(parseFloat(e.target.value))}
                className="w-full accent-green-600 mb-4"
              />
              <h4 className="text-xs font-medium text-zinc-500 mb-2">Confusion Matrix</h4>
              <div className="grid grid-cols-3 gap-1.5 text-center text-sm">
                <div></div>
                <div className="text-zinc-500 font-medium text-xs py-1">Predicted +</div>
                <div className="text-zinc-500 font-medium text-xs py-1">Predicted −</div>
                <div className="text-zinc-500 font-medium text-xs py-2">Actual +</div>
                <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-2">
                  <div className="text-xl font-bold text-green-700 dark:text-green-400">{tp}</div>
                  <div className="text-xs text-green-600 dark:text-green-500">TP</div>
                </div>
                <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-2">
                  <div className="text-xl font-bold text-red-700 dark:text-red-400">{fn}</div>
                  <div className="text-xs text-red-600 dark:text-red-500">FN</div>
                </div>
                <div className="text-zinc-500 font-medium text-xs py-2">Actual −</div>
                <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-2">
                  <div className="text-xl font-bold text-red-700 dark:text-red-400">{fp}</div>
                  <div className="text-xs text-red-600 dark:text-red-500">FP</div>
                </div>
                <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-2">
                  <div className="text-xl font-bold text-green-700 dark:text-green-400">{tn}</div>
                  <div className="text-xs text-green-600 dark:text-green-500">TN</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Metrics by training size - with model comparison */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 mb-6">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
              Metrics by Training Size
            </h3>
            <span className="text-xs text-zinc-500">F1 computed at threshold = 0.5</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-700">
                  <th className="text-left py-2 px-3 text-zinc-500">n</th>
                  <th className="text-center py-2 px-3 text-zinc-500 border-l border-zinc-200 dark:border-zinc-700" colSpan={2}>
                    <span className="text-green-600">Logistic</span>
                  </th>
                  <th className="text-center py-2 px-3 text-zinc-500 border-l border-zinc-200 dark:border-zinc-700" colSpan={2}>
                    <span className="text-purple-600">MLP</span>
                  </th>
                </tr>
                <tr className="border-b border-zinc-200 dark:border-zinc-700 text-xs">
                  <th></th>
                  <th className="text-right py-1 px-2 text-zinc-400 border-l border-zinc-200 dark:border-zinc-700">AUC</th>
                  <th className="text-right py-1 px-2 text-zinc-400">F1</th>
                  <th className="text-right py-1 px-2 text-zinc-400 border-l border-zinc-200 dark:border-zinc-700">AUC</th>
                  <th className="text-right py-1 px-2 text-zinc-400">F1</th>
                </tr>
              </thead>
              <tbody>
                {currentData.experiments.map((exp) => {
                  const mlpData = speciesDataByModel.mlp[selectedSpecies];
                  const mlpExp = mlpData?.experiments.find((e) => e.n_positive === exp.n_positive);
                  const logisticData = speciesDataByModel.logistic[selectedSpecies];
                  const logisticExp = logisticData?.experiments.find((e) => e.n_positive === exp.n_positive);

                  return (
                    <tr
                      key={exp.n_positive}
                      className={`border-b border-zinc-100 dark:border-zinc-800 cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        exp.n_positive === selectedNPositive ? "bg-zinc-100 dark:bg-zinc-800" : ""
                      }`}
                      onClick={() => setSelectedNPositive(exp.n_positive)}
                    >
                      <td className="py-2 px-3 font-medium">{exp.n_positive}</td>
                      <td className={`py-2 px-2 text-right border-l border-zinc-200 dark:border-zinc-700 ${logisticExp && logisticExp.auc_mean >= 0.7 ? "text-green-600" : logisticExp && logisticExp.auc_mean >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                        {logisticExp ? (
                          <span>
                            {(logisticExp.auc_mean * 100).toFixed(0)}%
                            <span className="text-zinc-400 text-xs ml-0.5">±{(logisticExp.auc_std * 100).toFixed(0)}</span>
                          </span>
                        ) : "-"}
                      </td>
                      <td className={`py-2 px-2 text-right ${logisticExp && logisticExp.f1_mean >= 0.7 ? "text-green-600" : logisticExp && logisticExp.f1_mean >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                        {logisticExp ? (
                          <span>
                            {(logisticExp.f1_mean * 100).toFixed(0)}%
                            <span className="text-zinc-400 text-xs ml-0.5">±{(logisticExp.f1_std * 100).toFixed(0)}</span>
                          </span>
                        ) : "-"}
                      </td>
                      <td className={`py-2 px-2 text-right border-l border-zinc-200 dark:border-zinc-700 ${mlpExp && mlpExp.auc_mean >= 0.7 ? "text-green-600" : mlpExp && mlpExp.auc_mean >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                        {mlpExp ? (
                          <span>
                            {(mlpExp.auc_mean * 100).toFixed(0)}%
                            <span className="text-zinc-400 text-xs ml-0.5">±{(mlpExp.auc_std * 100).toFixed(0)}</span>
                          </span>
                        ) : "-"}
                      </td>
                      <td className={`py-2 px-2 text-right ${mlpExp && mlpExp.f1_mean >= 0.7 ? "text-green-600" : mlpExp && mlpExp.f1_mean >= 0.5 ? "text-yellow-600" : "text-red-600"}`}>
                        {mlpExp ? (
                          <span>
                            {(mlpExp.f1_mean * 100).toFixed(0)}%
                            <span className="text-zinc-400 text-xs ml-0.5">±{(mlpExp.f1_std * 100).toFixed(0)}</span>
                          </span>
                        ) : "-"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Local Predictions */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl p-4 border border-zinc-200 dark:border-zinc-800 mt-6">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
                Predict at Your Location
              </h3>
              <p className="text-xs text-zinc-500 mt-1">
                Predict {speciesData[selectedSpecies]?.species || "species"} ({speciesNames[speciesData[selectedSpecies]?.species_key?.toString()] || "tree"}) presence in a 500m grid around you
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Model Type Selector */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Model:</span>
                <div className="flex rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                  <button
                    onClick={() => setModelType("logistic")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      modelType === "logistic"
                        ? "bg-green-600 text-white"
                        : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    }`}
                  >
                    Logistic
                  </button>
                  <button
                    onClick={() => setModelType("mlp")}
                    className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                      modelType === "mlp"
                        ? "bg-purple-600 text-white"
                        : "bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                    }`}
                  >
                    MLP
                  </button>
                </div>
              </div>
              <button
                onClick={handleFindMe}
                disabled={localLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {localLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Predicting...</span>
                  </>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Use My Location</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {localError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-600 dark:text-red-400 text-sm mb-4">
              {localError}
            </div>
          )}

          {localPredictions && userLocation && (
            <div className="space-y-4">

              {/* Satellite Map for Local Predictions */}
              {userLocation && (
                <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                  <div className="p-2 bg-zinc-50 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        {showConfidence && localPredictions.has_uncertainty ? (
                          <>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-green-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Confident</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-yellow-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Uncertain</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-red-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Very uncertain</span>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-red-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Likely present</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-yellow-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Maybe</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <div className="w-3 h-3 rounded bg-blue-500" />
                              <span className="text-zinc-600 dark:text-zinc-400">Unlikely</span>
                            </div>
                          </>
                        )}
                        <div className="flex items-center gap-1">
                          <div className="w-3 h-3 rounded-full bg-white border-2 border-zinc-800" />
                          <span className="text-zinc-600 dark:text-zinc-400">You</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {localPredictions.has_uncertainty && (
                          <button
                            onClick={() => setShowConfidence(!showConfidence)}
                            className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                              showConfidence
                                ? "bg-purple-600 text-white"
                                : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                            }`}
                          >
                            {showConfidence ? "Confidence" : "Probability"}
                          </button>
                        )}
                        <button
                          onClick={() => setShowHeatmap(!showHeatmap)}
                          className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                            showHeatmap
                              ? "bg-green-600 text-white"
                              : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-300"
                          }`}
                        >
                          {showHeatmap ? "Heatmap On" : "Heatmap Off"}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="h-[400px]">
                    {mounted && (
                      <MapContainer
                        center={[userLocation.lat, userLocation.lon]}
                        zoom={16}
                        style={{ height: "100%", width: "100%" }}
                      >
                        <TileLayer
                          attribution='&copy; <a href="https://www.esri.com/">Esri</a>'
                          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        />
                        {/* Heatmap rectangles */}
                        {showHeatmap && localPredictions.predictions.map((pt, idx) => {
                          const useConfidence = showConfidence && localPredictions.has_uncertainty;
                          const value = useConfidence ? (pt.confidence ?? 0.5) : pt.score;
                          let r, g, b;

                          if (useConfidence) {
                            // Green (confident) -> Yellow -> Red (uncertain)
                            if (value > 0.5) {
                              const t = (value - 0.5) * 2;
                              r = Math.round(255 * (1 - t));
                              g = 255;
                              b = 0;
                            } else {
                              const t = value * 2;
                              r = 255;
                              g = Math.round(255 * t);
                              b = 0;
                            }
                          } else {
                            // Blue (low) -> Yellow (medium) -> Red (high probability)
                            if (value < 0.5) {
                              const t = value * 2;
                              r = Math.round(255 * t);
                              g = Math.round(255 * t);
                              b = Math.round(255 * (1 - t));
                            } else {
                              const t = (value - 0.5) * 2;
                              r = 255;
                              g = Math.round(255 * (1 - t));
                              b = 0;
                            }
                          }
                          const color = `rgb(${r},${g},${b})`;

                          const pixelSize = 0.0001;
                          const bounds: [[number, number], [number, number]] = [
                            [pt.lat - pixelSize / 2, pt.lon - pixelSize / 2],
                            [pt.lat + pixelSize / 2, pt.lon + pixelSize / 2],
                          ];

                          return (
                            <Rectangle
                              key={`heatmap-${idx}`}
                              bounds={bounds}
                              pathOptions={{
                                color: color,
                                fillColor: color,
                                fillOpacity: 0.7,
                                weight: 0,
                              }}
                            >
                              <Popup>
                                <div className="text-sm">
                                  <div className="font-medium">Probability: {(pt.score * 100).toFixed(0)}%</div>
                                  {pt.confidence !== undefined && (
                                    <div className="text-purple-600">Confidence: {(pt.confidence * 100).toFixed(0)}%</div>
                                  )}
                                </div>
                              </Popup>
                            </Rectangle>
                          );
                        })}
                        {/* User location marker */}
                        <CircleMarker
                          center={[userLocation.lat, userLocation.lon]}
                          radius={8}
                          pathOptions={{
                            color: "#1f2937",
                            fillColor: "#ffffff",
                            fillOpacity: 1,
                            weight: 3,
                          }}
                        >
                          <Popup>
                            <div className="text-sm">
                              <div className="font-medium">Your Location</div>
                            </div>
                          </Popup>
                        </CircleMarker>
                      </MapContainer>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      </main>
    </div>
  );
}
