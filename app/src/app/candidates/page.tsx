"use client";

import { useState } from "react";
import CandidateMap from "@/components/CandidateMap";
import OccurrenceMap from "@/components/OccurrenceMap";
import Link from "next/link";

export default function CandidatesPage() {
  const [species, setSpecies] = useState("oak");
  const [minProbability, setMinProbability] = useState(0.6);
  const [inputSpecies, setInputSpecies] = useState("oak");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSpecies(inputSpecies);
  };

  // Map species display name to occurrence file name
  const getOccurrenceSpecies = (sp: string) => {
    const mapping: Record<string, string> = {
      oak: "quercus_robur",
    };
    return mapping[sp.toLowerCase()] || sp;
  };

  return (
    <div className="min-h-screen bg-zinc-950 p-4 md:p-8">
      <main className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-center gap-4">
          <Link
            href="/"
            className="text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100">
              Species Location Analysis
            </h1>
            <p className="text-zinc-400 text-sm">
              Compare GBIF occurrences with predicted candidate locations
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="bg-zinc-900 rounded-xl p-4 mb-6 border border-zinc-800">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm text-zinc-400 mb-1">Species</label>
              <input
                type="text"
                value={inputSpecies}
                onChange={(e) => setInputSpecies(e.target.value)}
                className="px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="e.g., oak"
              />
            </div>
            <div>
              <label className="block text-sm text-zinc-400 mb-1">
                Min Probability: {minProbability.toFixed(2)}
              </label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={minProbability}
                onChange={(e) => setMinProbability(parseFloat(e.target.value))}
                className="w-48 accent-green-500"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              Load Data
            </button>
          </form>
        </div>

        {/* Maps side by side */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* GBIF Occurrences */}
          <OccurrenceMap species={getOccurrenceSpecies(species)} />

          {/* Predicted Candidates */}
          <CandidateMap species={species} minProbability={minProbability} />
        </div>

        {/* Info */}
        <div className="bg-zinc-900 rounded-xl p-4 border border-zinc-800">
          <h3 className="text-zinc-100 font-medium mb-2">About</h3>
          <p className="text-zinc-400 text-sm">
            <strong className="text-zinc-300">Left:</strong> GBIF occurrence records showing where the species has been observed.
            <br />
            <strong className="text-zinc-300">Right:</strong> Candidate locations predicted by a classifier trained on Tessera
            geospatial foundation model embeddings. Points are colored by prediction probability
            (red = lower, green = higher).
          </p>
        </div>
      </main>
    </div>
  );
}
