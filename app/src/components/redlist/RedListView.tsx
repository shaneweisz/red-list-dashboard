"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import TaxaSummary from "./TaxaSummary";
import NewLiteratureSinceAssessment from "../LiteratureSearch";
import RedListAssessments from "../RedListAssessments";
import CitesSummary from "../CitesSummary";
import WikipediaSummary from "../WikipediaSummary";
import EolSummary from "../EolSummary";
import TaxaIcon from "../TaxaIcon";
import { ALPHA2_TO_NAME, type CountryStats } from "../WorldMap";
import { CATEGORY_COLORS, TAXA_BY_ID, THREATENED_CATEGORIES } from "@/config/taxa";
import { speciesMatchesNode, getNodeDef, getViewRootForNode, findNode, matchesBreakdownName, breakdownDisplayName } from "@/lib/taxonomy-utils";
import { dynamicNodeDisplayName } from "@/lib/dynamic-taxon";
import ReviewerChart from "./ReviewerChart";
import { parseAssessors } from "@/lib/parseAssessors";
import { iucnRegionCountries, countryToIucnRegion } from "@/lib/regions";
import { useFilterParams } from "@/hooks/useFilterParams";
import { parseHabitatEntries, matchesHabitatFilter as matchesHabitatCriteria, coarseKnownCategories, isRestrictiveSelection, ALL_HABITAT_SEASONS, ALL_HABITAT_IMPORTANCE, ALL_HABITAT_SUITABILITY } from "@/lib/habitat-filter";
import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";
import { useSpeciesCache } from "@/contexts/SpeciesCacheContext";
import { isOutdated, outdatedCutoffDate } from "@/lib/outdated";

import AssessorCandidatesTable from "../AssessorCandidatesTable";
import ReviewerCandidatesTable from "../ReviewerCandidatesTable";
import { getLastSearchResult, clearLastSearchResult } from "../SpeciesSearchBar";

// Species list is served by the DuckDB/Parquet-backed /api/redlist/species route.
const SPECIES_API = "/api/redlist/species";

// Dynamically import OccurrenceMapRow to avoid SSR issues with Leaflet
const OccurrenceMapRow = dynamic(
  () => import("../OccurrenceMapRow"),
  { ssr: false }
);

// iNat-only observations panel, shown when a species has no GBIF backbone match
const InatObservationsPanel = dynamic(
  () => import("../InatObservationsPanel"),
  { ssr: false }
);

// Dynamically import WorldMap to avoid SSR issues
const WorldMap = dynamic(
  () => import("../WorldMap"),
  { ssr: false }
);

// Dynamically import FilterBarChart to reduce initial bundle size (recharts is ~200KB)
const FilterBarChart = dynamic(
  () => import("./FilterBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

// Dedicated vertical bar chart for "Year of Latest Assessment" view
const YearBarChart = dynamic(
  () => import("./YearBarChart"),
  { ssr: false, loading: () => <div className="h-full animate-pulse bg-zinc-200 dark:bg-zinc-800 rounded" /> }
);

// Simple spinner component for loading states
function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`animate-spin h-5 w-5 text-zinc-400 ${className}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  );
}

// Use RedListSpecies from the hook; alias for convenience
type Species = RedListSpecies;

/** IUCN threat classification hierarchy */
const THREAT_CATEGORIES: { code: string; label: string; children: { code: string; label: string }[] }[] = [
  { code: "1", label: "Development", children: [
    { code: "1.1", label: "Housing & urban areas" }, { code: "1.2", label: "Commercial & industrial areas" }, { code: "1.3", label: "Tourism & recreation areas" },
  ]},
  { code: "2", label: "Agriculture", children: [
    { code: "2.1", label: "Crops" }, { code: "2.2", label: "Wood & pulp plantations" }, { code: "2.3", label: "Livestock farming & ranching" }, { code: "2.4", label: "Aquaculture" },
  ]},
  { code: "3", label: "Energy & Mining", children: [
    { code: "3.1", label: "Oil & gas drilling" }, { code: "3.2", label: "Mining & quarrying" }, { code: "3.3", label: "Renewable energy" },
  ]},
  { code: "4", label: "Transport", children: [
    { code: "4.1", label: "Roads & railroads" }, { code: "4.2", label: "Utility & service lines" }, { code: "4.3", label: "Shipping lanes" }, { code: "4.4", label: "Flight paths" },
  ]},
  { code: "5", label: "Harvesting", children: [
    { code: "5.1", label: "Hunting & trapping" }, { code: "5.2", label: "Gathering plants" }, { code: "5.3", label: "Logging & wood harvesting" }, { code: "5.4", label: "Fishing & harvesting" },
  ]},
  { code: "6", label: "Disturbance", children: [
    { code: "6.1", label: "Recreational activities" }, { code: "6.2", label: "War & military" }, { code: "6.3", label: "Work & other activities" },
  ]},
  { code: "7", label: "System modifications", children: [
    { code: "7.1", label: "Fire & fire suppression" }, { code: "7.2", label: "Dams & water management" }, { code: "7.3", label: "Other modifications" },
  ]},
  { code: "8", label: "Invasive species", children: [
    { code: "8.1", label: "Invasive non-native species" }, { code: "8.2", label: "Problematic native species" }, { code: "8.3", label: "Introduced genetic material" }, { code: "8.4", label: "Unknown origin species" }, { code: "8.5", label: "Viral/prion diseases" }, { code: "8.6", label: "Diseases of unknown cause" },
  ]},
  { code: "9", label: "Pollution", children: [
    { code: "9.1", label: "Domestic & urban waste water" }, { code: "9.2", label: "Industrial & military effluents" }, { code: "9.3", label: "Agricultural & forestry effluents" },
    { code: "9.4", label: "Garbage & solid waste" }, { code: "9.5", label: "Air-borne pollutants" }, { code: "9.6", label: "Excess energy (light, thermal, noise)" },
  ]},
  { code: "10", label: "Geological events", children: [
    { code: "10.1", label: "Volcanoes" }, { code: "10.2", label: "Earthquakes/tsunamis" }, { code: "10.3", label: "Avalanches/landslides" },
  ]},
  { code: "11", label: "Climate change", children: [
    { code: "11.1", label: "Habitat shifting & alteration" }, { code: "11.2", label: "Droughts" }, { code: "11.3", label: "Temperature extremes" }, { code: "11.4", label: "Storms & flooding" }, { code: "11.5", label: "Other impacts" },
  ]},
  { code: "12", label: "Other", children: [
    { code: "12.1", label: "Other threat" },
  ]},
];

// IUCN habitat classification (18 top-level categories, 126 codes total) — see
// https://www.iucnredlist.org/resources/habitat-classification-scheme. A handful
// of codes go a 3rd level deep (e.g. 11.1.1/11.1.2 under 11.1, 9.8.1-9.8.6 under
// 9.8); those are intentionally folded into their 2nd-level parent rather than
// given their own drill row, mirroring THREAT_CATEGORIES' 2-level depth — the
// prefix-based matching (code.startsWith(sel + ".")) still counts a species
// under e.g. "11.1.1" when "11.1" is selected, it just isn't its own pill.
const HABITAT_CATEGORIES: { code: string; label: string; children: { code: string; label: string }[] }[] = [
  { code: "1", label: "Forest", children: [
    { code: "1.1", label: "Forest - Boreal" }, { code: "1.2", label: "Forest - Subarctic" }, { code: "1.3", label: "Forest - Subantarctic" }, { code: "1.4", label: "Forest - Temperate" }, { code: "1.5", label: "Forest - Subtropical/Tropical Dry" }, { code: "1.6", label: "Forest - Subtropical/Tropical Moist Lowland" }, { code: "1.7", label: "Forest - Subtropical/Tropical Mangrove Vegetation Above High Tide Level" }, { code: "1.8", label: "Forest - Subtropical/Tropical Swamp" }, { code: "1.9", label: "Forest - Subtropical/Tropical Moist Montane" },
  ]},
  { code: "2", label: "Savanna", children: [
    { code: "2.1", label: "Savanna - Dry" }, { code: "2.2", label: "Savanna - Moist" },
  ]},
  { code: "3", label: "Shrubland", children: [
    { code: "3.1", label: "Shrubland - Subarctic" }, { code: "3.2", label: "Shrubland - Subantarctic" }, { code: "3.3", label: "Shrubland - Boreal" }, { code: "3.4", label: "Shrubland - Temperate" }, { code: "3.5", label: "Shrubland - Subtropical/Tropical Dry" }, { code: "3.6", label: "Shrubland - Subtropical/Tropical Moist" }, { code: "3.7", label: "Shrubland - Subtropical/Tropical High Altitude" }, { code: "3.8", label: "Shrubland - Mediterranean-type Shrubby Vegetation" },
  ]},
  { code: "4", label: "Grassland", children: [
    { code: "4.1", label: "Grassland - Tundra" }, { code: "4.2", label: "Grassland - Subarctic" }, { code: "4.3", label: "Grassland - Subantarctic" }, { code: "4.4", label: "Grassland - Temperate" }, { code: "4.5", label: "Grassland - Subtropical/Tropical Dry" }, { code: "4.6", label: "Grassland - Subtropical/Tropical Seasonally Wet/Flooded" }, { code: "4.7", label: "Grassland - Subtropical/Tropical High Altitude" },
  ]},
  { code: "5", label: "Wetlands (inland)", children: [
    { code: "5.1", label: "Wetlands (inland) - Permanent Rivers/Streams/Creeks (includes waterfalls)" }, { code: "5.2", label: "Wetlands (inland) - Seasonal/Intermittent/Irregular Rivers/Streams/Creeks" }, { code: "5.3", label: "Wetlands (inland) - Shrub Dominated Wetlands" }, { code: "5.4", label: "Wetlands (inland) - Bogs, Marshes, Swamps, Fens, Peatlands" }, { code: "5.5", label: "Wetlands (inland) - Permanent Freshwater Lakes (over 8ha)" }, { code: "5.6", label: "Wetlands (inland) - Seasonal/Intermittent Freshwater Lakes (over 8ha)" }, { code: "5.7", label: "Wetlands (inland) - Permanent Freshwater Marshes/Pools (under 8ha)" }, { code: "5.8", label: "Wetlands (inland) - Seasonal/Intermittent Freshwater Marshes/Pools (under 8ha)" }, { code: "5.9", label: "Wetlands (inland) - Freshwater Springs and Oases" }, { code: "5.10", label: "Wetlands (inland) - Tundra Wetlands (incl. pools and temporary waters from snowmelt)" }, { code: "5.11", label: "Wetlands (inland) - Alpine Wetlands (includes temporary waters from snowmelt)" }, { code: "5.12", label: "Wetlands (inland) - Geothermal Wetlands" }, { code: "5.13", label: "Wetlands (inland) - Permanent Inland Deltas" }, { code: "5.14", label: "Wetlands (inland) - Permanent Saline, Brackish or Alkaline Lakes" }, { code: "5.15", label: "Wetlands (inland) - Seasonal/Intermittent Saline, Brackish or Alkaline Lakes and Flats" }, { code: "5.16", label: "Wetlands (inland) - Permanent Saline, Brackish or Alkaline Marshes/Pools" }, { code: "5.17", label: "Wetlands (inland) - Seasonal/Intermittent Saline, Brackish or Alkaline Marshes/Pools" }, { code: "5.18", label: "Wetlands (inland) - Karst and Other Subterranean Hydrological Systems (inland)" },
  ]},
  { code: "6", label: "Rocky areas (eg. inland cliffs, mountain peaks)", children: [
  ]},
  { code: "7", label: "Caves and Subterranean Habitats (non-aquatic)", children: [
    { code: "7.1", label: "Caves and Subterranean Habitats (non-aquatic) - Caves" }, { code: "7.2", label: "Caves and Subterranean Habitats (non-aquatic) - Other Subterranean Habitats" },
  ]},
  { code: "8", label: "Desert", children: [
    { code: "8.1", label: "Desert - Hot" }, { code: "8.2", label: "Desert - Temperate" }, { code: "8.3", label: "Desert - Cold" },
  ]},
  { code: "9", label: "Marine Neritic", children: [
    { code: "9.1", label: "Marine Neritic - Pelagic" }, { code: "9.2", label: "Marine Neritic - Subtidal Rock and Rocky Reefs" }, { code: "9.3", label: "Marine Neritic - Subtidal Loose Rock/pebble/gravel" }, { code: "9.4", label: "Marine Neritic - Subtidal Sandy" }, { code: "9.5", label: "Marine Neritic - Subtidal Sandy-Mud" }, { code: "9.6", label: "Marine Neritic - Subtidal Muddy" }, { code: "9.7", label: "Marine Neritic - Macroalgal/Kelp" }, { code: "9.8", label: "Marine Neritic - Coral Reef" }, { code: "9.9", label: "Marine Neritic - Seagrass (Submerged)" }, { code: "9.10", label: "Marine Neritic - Estuaries" },
  ]},
  { code: "10", label: "Marine Oceanic", children: [
    { code: "10.1", label: "Marine Oceanic - Epipelagic (0-200m)" }, { code: "10.2", label: "Marine Oceanic - Mesopelagic (200-1000m)" }, { code: "10.3", label: "Marine Oceanic - Bathypelagic (1000-4000m)" }, { code: "10.4", label: "Marine Oceanic - Abyssopelagic (4000-6000m)" },
  ]},
  { code: "11", label: "Marine Deep Benthic", children: [
    { code: "11.1", label: "Marine Deep Benthic - Continental Slope/Bathyl Zone (200-4,000m)" }, { code: "11.2", label: "Marine Deep Benthic - Abyssal Plain (4,000-6,000m)" }, { code: "11.3", label: "Marine Deep Benthic - Abyssal Mountain/Hills (4,000-6,000m)" }, { code: "11.4", label: "Marine Deep Benthic - Hadal/Deep Sea Trench (>6,000m)" }, { code: "11.5", label: "Marine Deep Benthic - Seamount" }, { code: "11.6", label: "Marine Deep Benthic - Deep Sea Vents (Rifts/Seeps)" },
  ]},
  { code: "12", label: "Marine Intertidal", children: [
    { code: "12.1", label: "Marine Intertidal - Rocky Shoreline" }, { code: "12.2", label: "Marine Intertidal - Sandy Shoreline and/or Beaches, Sand Bars, Spits, Etc" }, { code: "12.3", label: "Marine Intertidal - Shingle and/or Pebble Shoreline and/or Beaches" }, { code: "12.4", label: "Marine Intertidal - Mud Flats and Salt Flats" }, { code: "12.5", label: "Marine Intertidal - Salt Marshes (Emergent Grasses)" }, { code: "12.6", label: "Marine Intertidal - Tidepools" }, { code: "12.7", label: "Marine Intertidal - Mangrove Submerged Roots" },
  ]},
  { code: "13", label: "Marine Coastal/Supratidal", children: [
    { code: "13.1", label: "Marine Coastal/Supratidal - Sea Cliffs and Rocky Offshore Islands" }, { code: "13.2", label: "Marine Coastal/supratidal - Coastal Caves/Karst" }, { code: "13.3", label: "Marine Coastal/Supratidal - Coastal Sand Dunes" }, { code: "13.4", label: "Marine Coastal/Supratidal - Coastal Brackish/Saline Lagoons/Marine Lakes" }, { code: "13.5", label: "Marine Coastal/Supratidal - Coastal Freshwater Lakes" },
  ]},
  { code: "14", label: "Artificial/Terrestrial", children: [
    { code: "14.1", label: "Artificial/Terrestrial - Arable Land" }, { code: "14.2", label: "Artificial/Terrestrial - Pastureland" }, { code: "14.3", label: "Artificial/Terrestrial - Plantations" }, { code: "14.4", label: "Artificial/Terrestrial - Rural Gardens" }, { code: "14.5", label: "Artificial/Terrestrial - Urban Areas" }, { code: "14.6", label: "Artificial/Terrestrial - Subtropical/Tropical Heavily Degraded Former Forest" },
  ]},
  { code: "15", label: "Artificial/Aquatic & Marine", children: [
    { code: "15.1", label: "Artificial/Aquatic - Water Storage Areas (over 8ha)" }, { code: "15.2", label: "Artificial/Aquatic - Ponds (below 8ha)" }, { code: "15.3", label: "Artificial/Aquatic - Aquaculture Ponds" }, { code: "15.4", label: "Artificial/Aquatic - Salt Exploitation Sites" }, { code: "15.5", label: "Artificial/Aquatic - Excavations (open)" }, { code: "15.6", label: "Artificial/Aquatic - Wastewater Treatment Areas" }, { code: "15.7", label: "Artificial/Aquatic - Irrigated Land (includes irrigation channels)" }, { code: "15.8", label: "Artificial/Aquatic - Seasonally Flooded Agricultural Land" }, { code: "15.9", label: "Artificial/Aquatic - Canals and Drainage Channels, Ditches" }, { code: "15.10", label: "Artificial/Aquatic - Karst and Other Subterranean Hydrological Systems (human-made)" }, { code: "15.11", label: "Artificial/Marine - Marine Anthropogenic Structures" }, { code: "15.12", label: "Artificial/Marine - Mariculture Cages" }, { code: "15.13", label: "Artificial/Marine - Mari/Brackishculture Ponds" },
  ]},
  { code: "16", label: "Introduced vegetation", children: [
  ]},
  { code: "17", label: "Other", children: [
  ]},
  { code: "18", label: "Unknown", children: [
  ]},
];

interface CriteriaNode {
  code: string;
  label: string;
  children: CriteriaNode[];
}

// Roman-numeral sub-items shared by B1b/B1c/B2b/B2c ("continuing decline in" /
// "extreme fluctuations in" — same list of 5 parameters either way).
const ROMAN_NUMERAL_LABELS: Record<string, string> = {
  i: "extent of occurrence",
  ii: "area of occupancy",
  iii: "area, extent, and/or quality of habitat",
  iv: "number of locations or subpopulations",
  v: "number of mature individuals",
};
function romanChildren(prefix: string, numerals: readonly string[]): CriteriaNode[] {
  return numerals.map(r => ({ code: `${prefix}(${r})`, label: `${prefix}(${r}) — ${ROMAN_NUMERAL_LABELS[r]}`, children: [] }));
}
const B_ROMANS = ["i", "ii", "iii", "iv", "v"] as const;
function bSubclauses(num: string): CriteriaNode[] {
  return [
    { code: `B${num}a`, label: `B${num}a — Severely fragmented or few locations`, children: [] },
    { code: `B${num}b`, label: `B${num}b — Continuing decline in`, children: romanChildren(`B${num}b`, B_ROMANS) },
    { code: `B${num}c`, label: `B${num}c — Extreme fluctuations in`, children: romanChildren(`B${num}c`, B_ROMANS) },
  ];
}
function aSubclauses(num: string): CriteriaNode[] {
  return [
    { code: `A${num}a`, label: `A${num}a — Direct observation`, children: [] },
    { code: `A${num}b`, label: `A${num}b — Index of abundance`, children: [] },
    { code: `A${num}c`, label: `A${num}c — Decline in area of occupancy, extent of occurrence, and/or habitat quality`, children: [] },
    { code: `A${num}d`, label: `A${num}d — Levels of exploitation`, children: [] },
    { code: `A${num}e`, label: `A${num}e — Effects of introduced taxa, hybridization, pathogens, pollutants, competitors, or parasites`, children: [] },
  ];
}

// IUCN Red List criteria (A-E), their numbered sub-criteria (A1-A4/B1-B2/C1-C2/D1-D2/E),
// and — where the framework defines them — the sub-clause letters and roman-numeral
// qualifiers beneath those. Depth varies genuinely by branch, not just by how far someone
// bothered to fill it in: A's a-e are evidence types with no further split; B1/B2's a/b/c
// share one vocabulary, with only b/c carrying the 5 roman-numeral "declining/fluctuating
// in ___" qualifiers; C1 and D1/D2/E have no sub-clauses at all; C2's a/b differ from B's
// a/b/c entirely (population structure vs. extreme fluctuations), with only a(i)/a(ii)
// going one level deeper. See https://www.iucnredlist.org/resources/categories-and-criteria.
const CRITERIA_CATEGORIES: CriteriaNode[] = [
  { code: "A", label: "A — Population reduction", children: [
    { code: "A1", label: "A1 — Past reduction, reversible & understood & ceased", children: aSubclauses("1") },
    { code: "A2", label: "A2 — Past reduction, may not be reversible", children: aSubclauses("2") },
    { code: "A3", label: "A3 — Future reduction projected", children: aSubclauses("3") },
    { code: "A4", label: "A4 — Reduction, past and future", children: aSubclauses("4") },
  ]},
  { code: "B", label: "B — Small range", children: [
    { code: "B1", label: "B1 — Extent of occurrence", children: bSubclauses("1") },
    { code: "B2", label: "B2 — Area of occupancy", children: bSubclauses("2") },
  ]},
  { code: "C", label: "C — Small population & decline", children: [
    { code: "C1", label: "C1 — Continuing decline (quantified rate)", children: [] },
    { code: "C2", label: "C2 — Continuing decline (fragmented/fluctuating/subpopulations)", children: [
      { code: "C2a", label: "C2a — Population structure", children: [
        { code: "C2a(i)", label: "C2a(i) — No subpopulation estimated to contain more than X mature individuals", children: [] },
        { code: "C2a(ii)", label: "C2a(ii) — ~100% of individuals in one subpopulation", children: [] },
      ]},
      { code: "C2b", label: "C2b — Extreme fluctuations in number of mature individuals", children: [] },
    ]},
  ]},
  { code: "D", label: "D — Very small or restricted population", children: [
    { code: "D1", label: "D1 — Very small population", children: [] },
    { code: "D2", label: "D2 — Restricted area of occupancy / very few locations", children: [] },
  ]},
  { code: "E", label: "E — Quantitative analysis", children: [] },
];

function findCriteriaNode(nodes: CriteriaNode[], code: string): CriteriaNode | null {
  for (const node of nodes) {
    if (node.code === code) return node;
    const found = findCriteriaNode(node.children, code);
    if (found) return found;
  }
  return null;
}

// Splits a criteria string on top-level "; " or ", " separators — real assessment data
// uses both inconsistently (e.g. "B1+2c, D2" alongside "A3c; B2b(iii)") — without
// splitting on commas *inside* a roman-numeral group like "(i,ii,iii)".
function splitCriteriaTopLevel(criteria: string): string[] {
  const segments: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of criteria) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if ((ch === ";" || ch === ",") && depth === 0) {
      segments.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  if (current) segments.push(current);
  return segments.map(s => s.trim()).filter(Boolean);
}

// Parses a raw IUCN criteria string into every code it satisfies, at every level: top
// letter, number (B1), sub-clause (B1a), and roman-numeral qualifier (B1b(iii)). E.g.
// "B1ab(iii)+2ab(iii)" -> ["B1","B1a","B1b","B1b(iii)","B2","B2a","B2b","B2b(iii)"].
// Handles two real-world conventions for "+N" continuations (both seen in production
// data): full repetition ("B1ab(iii)+2ab(iii)", sub-clauses spelled out for each number)
// and B's compact form ("B1+2c", sub-clauses given once for the whole chain) — the
// compact form is only safe to assume for B, since B1/B2 share one sub-clause vocabulary,
// unlike e.g. C1/C2 which don't (so "C1+2a(i)" must NOT retroactively give C1 a sub-clause
// it doesn't have).
function parseCriteriaCodes(criteria: string | null | undefined): string[] {
  if (!criteria) return [];
  const codes = new Set<string>();
  for (const segment of splitCriteriaTopLevel(criteria)) {
    const parts = segment.split("+").map(p => p.trim()).filter(Boolean);
    if (parts.length === 0) continue;
    let letter: string | null = null;
    const parsed: { numberCode: string; rest: string }[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const headMatch = i === 0 ? part.match(/^([A-E])(\d*)/) : part.match(/^(\d+)/);
      if (!headMatch) { if (i === 0) break; else continue; }
      if (i === 0) letter = headMatch[1];
      if (!letter) continue;
      const num = i === 0 ? headMatch[2] : headMatch[1];
      parsed.push({ numberCode: letter + num, rest: part.slice(headMatch[0].length) });
    }
    if (letter === "B") {
      const withRest = parsed.filter(p => p.rest !== "");
      if (withRest.length === 1 && parsed.length > 1) {
        const shared = withRest[0].rest;
        for (const p of parsed) p.rest = shared;
      }
    }
    for (const { numberCode, rest } of parsed) {
      codes.add(numberCode);
      const subRe = /([a-e])(?:\(([^)]*)\))?/g;
      let sm: RegExpExecArray | null;
      while ((sm = subRe.exec(rest)) !== null) {
        const subCode = numberCode + sm[1];
        codes.add(subCode);
        if (sm[2]) {
          for (const numeral of sm[2].split(",").map(x => x.trim()).filter(Boolean)) {
            codes.add(`${subCode}(${numeral})`);
          }
        }
      }
    }
  }
  return [...codes];
}

// Season chip options for the Habitat card's season multi-select — full IUCN
// labels (used for matching and as the button title) paired with a shorter
// display label so five chips fit in a narrow card.
const HABITAT_SEASON_OPTIONS: { value: string; short: string }[] = [
  { value: "Resident", short: "Resident" },
  { value: "Breeding Season", short: "Breeding" },
  { value: "Non-Breeding Season", short: "Non-breeding" },
  { value: "Passage", short: "Passage" },
  { value: "Seasonal Occurrence Unknown", short: "Unknown" },
];

// Importance dropdown options — same checkbox-multi-select shape as season,
// covering all 3 possible parseHabitatEntries().importance values.
const HABITAT_IMPORTANCE_OPTIONS: { value: string; short: string }[] = [
  { value: "Major", short: "Major" },
  { value: "Not major", short: "Minor" },
  { value: "Unknown", short: "Unknown" },
];

// Suitability dropdown options — same checkbox-multi-select shape as importance,
// covering all 3 possible parseHabitatEntries().suitability values.
const HABITAT_SUITABILITY_OPTIONS: { value: string; short: string }[] = [
  { value: "Suitable", short: "Suitable" },
  { value: "Marginal", short: "Marginal" },
  { value: "Unknown", short: "Unknown" },
];

interface InatDefaultImage {
  squareUrl: string | null;
  mediumUrl: string | null;
}

interface GbifMatchStatus {
  matchType: string;
  matchedName?: string;
  matchedRank?: string;
}

interface SpeciesDetails {
  criteria: string | null;
  commonName: string | null;
  gbifUrl: string | null;
  gbifOccurrences: number | null;
  gbifOccurrencesSinceAssessment: number | null;
  gbifMatchStatus: GbifMatchStatus | null;
  // undefined = still loading (show spinner), null = fetched, no image
  inatDefaultImage: InatDefaultImage | null | undefined;
  // Whether criteria/gbifMatchStatus have been fetched (to avoid re-fetching on null)
  criteriaFetched?: boolean;
  gbifMatchFetched?: boolean;
}


// Debounced search input — manages own state for instant typing, debounces parent updates.
// Filters the currently-visible species table by name in place, composing with whatever
// pill filters are already active (e.g. Mammals + EN + Mexico, then narrow to "mouse") —
// distinct from the page header's SpeciesSearchBar, which navigates to a taxon/species
// instead of narrowing the current view. Placeholder text keeps the two from reading as
// duplicates of each other.
function DebouncedSearchInput({
  onSearch,
  initialValue = "",
  placeholder = "Filter by name...",
  className,
}: {
  onSearch: (value: string) => void;
  initialValue?: string;
  placeholder?: string;
  className?: string;
}) {
  const [localValue, setLocalValue] = useState(initialValue);

  useEffect(() => {
    setLocalValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(localValue.toLowerCase());
    }, 200);
    return () => clearTimeout(timer);
  }, [localValue, onSearch]);

  return (
    <input
      type="text"
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      placeholder={placeholder}
      className={className}
    />
  );
}

// Explain IUCN Red List criteria codes
// See: https://www.iucnredlist.org/resources/categories-and-criteria
function explainCriteria(criteria: string): string {
  if (!criteria) return "";

  const explanations: string[] = [];

  // Criterion A: Population size reduction
  if (criteria.includes("A1")) explanations.push("past population reduction, reversible");
  else if (criteria.includes("A2")) explanations.push("past population reduction, may not be reversible");
  else if (criteria.includes("A3")) explanations.push("future population reduction projected");
  else if (criteria.includes("A4")) explanations.push("population reduction past & future");
  else if (criteria.startsWith("A")) explanations.push("population reduction");

  // Criterion B: Geographic range (small range + fragmented/declining/fluctuating)
  if (criteria.includes("B1")) explanations.push("restricted extent of occurrence");
  if (criteria.includes("B2")) explanations.push("restricted area of occupancy");

  // Criterion C: Small population size and decline
  if (criteria.startsWith("C") || criteria.includes("+C")) explanations.push("small declining population");

  // Criterion D: Very small or restricted population
  if (criteria.startsWith("D") || criteria.includes("+D")) explanations.push("very small/restricted population");

  // Criterion E: Quantitative analysis
  if (criteria.startsWith("E") || criteria.includes("+E")) explanations.push("extinction probability analysis");

  return explanations.length > 0 ? ` (${explanations.join("; ")})` : "";
}

// Quick hover tooltip using portal
function HoverTooltip({ children, text }: { children: React.ReactNode; text: string }) {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {children}
      {isHovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] px-2 py-1 text-xs bg-zinc-800 text-zinc-200 rounded shadow-lg max-w-[250px] text-center"
          style={{
            top: position.top,
            left: position.left,
            transform: 'translateX(-50%) translateY(-100%)',
          }}
        >
          {text}
        </div>,
        document.body
      )}
    </span>
  );
}


function GbifInfoTooltip() {
  const [isHovered, setIsHovered] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [isHovered]);

  return (
    <span
      ref={triggerRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {isHovered && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[99999] bg-zinc-900 dark:bg-zinc-800 text-white text-[9px] leading-snug rounded px-2 py-1.5 shadow-lg w-64"
          style={{
            top: position.top,
            left: position.left,
            transform: 'translateX(-50%) translateY(-100%)',
          }}
        >
          <div className="font-medium text-[10px] mb-0.5">Georeferenced GBIF records only:</div>
          <div className="text-zinc-400"><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">hasCoordinate=true</code> · <code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">hasGeospatialIssue=false</code></div>
          <div className="font-medium text-zinc-100 mt-1">Included:</div>
          <ul className="text-zinc-300 list-disc list-inside">
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">HUMAN_OBSERVATION</code> <span className="text-zinc-400">(e.g. iNat, eBird)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MACHINE_OBSERVATION</code> <span className="text-zinc-400">(e.g. camera traps)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_SAMPLE</code> <span className="text-zinc-400">(e.g. eDNA)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OCCURRENCE</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">OBSERVATION</code></li>
          </ul>
          <div className="font-medium text-zinc-100 mt-1">Excluded:</div>
          <ul className="text-zinc-300 list-disc list-inside">
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">PRESERVED_SPECIMEN</code> <span className="text-zinc-400">(e.g. herbaria, museums)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">MATERIAL_CITATION</code> <span className="text-zinc-400">(may include fossils)</span></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">FOSSIL_SPECIMEN</code></li>
            <li><code className="bg-zinc-800 dark:bg-zinc-700 px-0.5 rounded">LIVING_SPECIMEN</code> <span className="text-zinc-400">(e.g. zoos)</span></li>
          </ul>
        </div>,
        document.body
      )}
    </span>
  );
}

interface RedListViewProps {
  viewMode?: "reassessments" | "new-assessments";
  onViewModeChange?: (mode: "reassessments" | "new-assessments") => void;
  sharedTaxa?: Set<string>;
  sharedSubgroups?: Set<string>;
  onTaxaChange?: (taxa: Set<string>) => void;
  onSubgroupsChange?: (subgroups: Set<string>) => void;
  // Namespaces this instance's URL params (e.g. "_b" turns `taxa` into `taxa_b`) so
  // two instances can share one URL without clobbering each other — compare mode's
  // second panel. Defaults to "" (today's single-dashboard behavior).
  paramSuffix?: string;
}

export default function RedListView({ viewMode = "reassessments", onViewModeChange, sharedTaxa, sharedSubgroups, onTaxaChange, onSubgroupsChange, paramSuffix = "" }: RedListViewProps = {}) {
  const isNewAssessments = viewMode === "new-assessments";

  // The ">10 yrs old" outdated threshold is computed against this everywhere
  // in this component (species filtering, the by-year chart, the map, the
  // toggle's tooltip) instead of "today" — TaxaSummary's own table numbers
  // (data/taxa-summary.json) are baked in at the last sync, not live, so
  // computing "outdated" against today's wall-clock date here would drift
  // further from the table's counts the longer it's been since the last
  // rebuild. Falls back to isOutdated/outdatedCutoffDate's own `now =
  // new Date()` default until this resolves (same fetch OutdatedInfoIcon
  // in TaxaSummary.tsx already makes, kept independent rather than shared
  // state since it's a one-off, cached-for-an-hour value either component
  // can fetch on its own).
  const [dataAsOf, setDataAsOf] = useState<Date | undefined>(undefined);
  useEffect(() => {
    fetch("/api/data-sync-date")
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (data?.dataAsOf) setDataAsOf(new Date(data.dataAsOf)); })
      .catch(() => {});
  }, []);

  // The species table scrolls horizontally on narrow screens, so an expanded
  // detail row's `<td colSpan>` is as wide as the (often off-screen) table, not
  // the viewport. Expose the scroll container's *visible* width as a CSS var so
  // the detail panel can size itself to fit the screen instead of overflowing.
  const tableScrollCleanupRef = useRef<(() => void) | null>(null);
  const tableScrollRef = useCallback((el: HTMLDivElement | null) => {
    tableScrollCleanupRef.current?.();
    tableScrollCleanupRef.current = null;
    if (!el) return;
    const update = () => el.style.setProperty("--view-width", `${el.clientWidth}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    tableScrollCleanupRef.current = () => ro.disconnect();
  }, []);
  // Scroll target for the auto-focus effect below — the TaxaSummary table's
  // wrapper, not a dedicated stat-card row (there isn't one; the tree's own
  // selected-row + breadcrumb carries that context, and the toolbar's
  // species count covers the rest).
  const taxaSummaryScrollRef = useRef<HTMLDivElement>(null);
  // Filters synced with URL search params for shareable links
  const {
    layoutMode, setLayoutMode,
    originLayout,
    navigateToTaxonSubgroup,
    exitCountryModeForTaxon,
    returnToLayoutMode,
    enterCountryDrilldown,
    selectedTaxa, setSelectedTaxa,
    selectedSubgroups, setSelectedSubgroups,
    selectedCategories, setSelectedCategories,
    selectedYearRanges, setSelectedYearRanges,
    selectedAssessmentYears, setSelectedAssessmentYears,
    selectedDescribedYears, setSelectedDescribedYears,
    selectedCountries, setSelectedCountries,
    selectedObsRanges, setSelectedObsRanges,
    selectedAssessmentCounts, setSelectedAssessmentCounts,
    selectedSystems, setSelectedSystems,
    selectedPopulationTrends, setSelectedPopulationTrends,
    selectedMovementPatterns, setSelectedMovementPatterns,
    selectedThreats, setSelectedThreats,
    selectedCriteria, setSelectedCriteria,
    selectedHabitat, setSelectedHabitat,
    habitatBreadth, setHabitatBreadth,
    selectedHabitatImportance, setSelectedHabitatImportance,
    selectedHabitatSeasons, setSelectedHabitatSeasons,
    selectedHabitatSuitability, setSelectedHabitatSuitability,
    breakdownFilter, setBreakdownFilter,
    endemicsOnly, setEndemicsOnly,
    selectedGrowthForms, setSelectedGrowthForms,
    selectedAssessors, setSelectedAssessors,
    selectedReviewers, setSelectedReviewers,
    searchFilter, setSearchFilter,
    exactFilters, setExactFilters,
    sortField, sortDirection, setSort,
    mapViewMode, mapSortKey, mapSortDirection, setMapViewMode, setMapSort,
    clearAllFilters,
    clearAllFiltersAndTaxa,
    setViewMode: setUrlViewMode,
    species: urlSpecies, tab: urlTab,
    setSpeciesParam, setTabParam,
    fromPopstateRef,
  } = useFilterParams(paramSuffix);

  // Auto-scroll to the top of the TaxaSummary table whenever the focused
  // taxon changes (any tree click — top-level taxon, subgroup drill-down, or
  // navigating both at once). That table's own selected row + breadcrumb is
  // what carries "which taxon am I looking at" context (see TaxaSummary),
  // so scrolling it into view puts the tree row, the filters panel, and the
  // table toolbar all in frame together — the table that got you here stays
  // just one scroll above. Skips the very first render (a direct/bookmarked
  // taxon URL shouldn't jump-scroll on load) via isFirstTaxonFocusRef, then
  // fires on every subsequent identity change, including landing-page →
  // first taxon.
  const taxonFocusKey = `${[...selectedTaxa].sort().join(",")}|${[...selectedSubgroups].sort().join(",")}`;
  const isFirstTaxonFocusRef = useRef(true);
  useEffect(() => {
    if (isFirstTaxonFocusRef.current) { isFirstTaxonFocusRef.current = false; return; }
    taxaSummaryScrollRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [taxonFocusKey]);

  // Both habitat checkbox-dropdowns default to "everything checked" (see
  // useFilterParams.ts) — only a proper subset actually restricts anything,
  // so "is this filter active" (for badges/gating/chips) checks that, not
  // just `.size > 0`.
  const habitatImportanceActive = isRestrictiveSelection(selectedHabitatImportance, ALL_HABITAT_IMPORTANCE);
  const habitatSeasonsActive = isRestrictiveSelection(selectedHabitatSeasons, ALL_HABITAT_SEASONS);
  const habitatSuitabilityActive = isRestrictiveSelection(selectedHabitatSuitability, ALL_HABITAT_SUITABILITY);

  const cache = useSpeciesCache();
  const speciesApiUrl = useCallback(
    (taxonId: string, categoryParam: string) => `${SPECIES_API}?taxon=${encodeURIComponent(taxonId)}${categoryParam}`,
    []
  );

  // Country view needs real per-country location data, which Not Evaluated
  // species don't have (no assessment means no assessment_locations row) — see
  // the matching disabled-option guard in TaxaSummary's layoutModeSelect. Exit
  // back to the taxonomic default if New Assessments is switched on while
  // already in country view, rather than leaving an unreachable-but-still-active
  // mode selected.
  useEffect(() => {
    if (isNewAssessments && layoutMode === "country") setLayoutMode(null);
  }, [isNewAssessments, layoutMode, setLayoutMode]);

  // Initialize from shared state on mount (when switching from another view)
  const initializedRef = useRef(false);
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (sharedTaxa && sharedTaxa.size > 0 && selectedTaxa.size === 0) {
      setSelectedTaxa(sharedTaxa);
    }
    if (sharedSubgroups && sharedSubgroups.size > 0 && selectedSubgroups.size === 0) {
      setSelectedSubgroups(sharedSubgroups);
    }
  }, [sharedTaxa, sharedSubgroups, selectedTaxa, selectedSubgroups, setSelectedTaxa, setSelectedSubgroups]);

  // Sync taxa/subgroup changes up to parent
  useEffect(() => {
    onTaxaChange?.(selectedTaxa);
  }, [selectedTaxa, onTaxaChange]);

  useEffect(() => {
    onSubgroupsChange?.(selectedSubgroups);
  }, [selectedSubgroups, onSubgroupsChange]);

  // Sync viewMode prop to URL params (skip initial mount to avoid overwriting URL before page hydrates)
  const viewModeInitializedRef = useRef(false);
  useEffect(() => {
    if (!viewModeInitializedRef.current) {
      viewModeInitializedRef.current = true;
      return;
    }
    setUrlViewMode(viewMode);
  }, [viewMode, setUrlViewMode]);

  // Reset to Assessed whenever the taxon/sub-group selection changes — Not
  // Evaluated is something to opt into per-taxon, not a mode that should
  // silently follow you from one taxon to the next (you'd otherwise land on a
  // brand-new taxon already in NE mode from browsing a previous one, with no
  // visual cue you're not seeing its Assessed data). Skips the very first
  // render so a shared link's own ?view=new-assessments still works.
  const prevSelectionRef = useRef<{ taxa: Set<string>; subgroups: Set<string> } | null>(null);
  useEffect(() => {
    const prev = prevSelectionRef.current;
    prevSelectionRef.current = { taxa: selectedTaxa, subgroups: selectedSubgroups };
    if (prev === null) return;
    // Skip going from no taxa to some taxa too — this is URL hydration
    // (useFilterParams starts empty then populates from URL on mount), not a
    // user browsing to a new taxon. Without this, a shared link combining
    // ?view=new-assessments&taxa=X hydrates its taxa a render after this
    // effect's first (skipped, prev === null) run, so that second run sees
    // an empty→populated transition, misreads it as a real taxon change, and
    // immediately resets straight back to Assessed — the exact case the
    // "very first render" skip above was meant to protect (see the same
    // hydration guard on the "reset all other filters" effect below).
    if (prev.taxa.size === 0 && prev.subgroups.size === 0) return;
    const setsEqual = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((v) => b.has(v));
    const changed = !setsEqual(prev.taxa, selectedTaxa) || !setsEqual(prev.subgroups, selectedSubgroups);
    if (changed && isNewAssessments) onViewModeChange?.("reassessments");
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, onViewModeChange]);

  // Reset mode-specific filter state when switching between reassessments and
  // new-assessments. The shared species cache (SpeciesCacheContext) is NOT cleared
  // here — it's keyed by the exact request URL, which already differs between modes
  // (`?taxon=X` vs `?taxon=X&category=NE`), so each mode's data survives the switch
  // independently and toggling back to a mode already loaded for the current taxon
  // is instant instead of re-fetching from scratch every time.
  const prevViewModeRef = useRef(viewMode);
  useEffect(() => {
    if (prevViewModeRef.current === viewMode) return;
    prevViewModeRef.current = viewMode;
    // Clear assessment-specific filters (preserve search + species so search-bar navigation survives mode
    // switch; also preserve selectedSubgroups — new-assessments mode fetches a selected sub-group directly
    // (see the fetch effect below), so e.g. toggling Unassessed while viewing an SSC group should stay
    // scoped to that group, not fall back to all of Mammals)
    setSelectedCategories(new Set());
    setSelectedYearRanges(new Set());
    setSelectedAssessmentYears(new Set());
    setSelectedDescribedYears(new Set());
    setSelectedCountries(new Set());
    setSelectedObsRanges(new Set());
    setSelectedAssessmentCounts(new Set());
    setSelectedSystems(new Set());
    setSelectedPopulationTrends(new Set());
    setSelectedMovementPatterns(new Set());
    setSelectedThreats(new Set());
    setExpandedThreat(new Set());
    setSelectedCriteria(new Set());
    setExpandedCriteria(new Set());
    setSelectedHabitat(new Set());
    setExpandedHabitat(new Set());
    setHabitatBreadth(null);
    setSelectedHabitatImportance(new Set(ALL_HABITAT_IMPORTANCE));
    setSelectedHabitatSeasons(new Set(ALL_HABITAT_SEASONS));
    setSelectedHabitatSuitability(new Set(ALL_HABITAT_SUITABILITY));
    setEndemicsOnly(false);
    setSelectedGrowthForms(new Set());
    setSelectedAssessors(new Set());
    setSelectedReviewers(new Set());
    setSort(null, "desc");
    setShowOnlyStarred(false);
    // Clear "all" taxa selection when switching to new-assessments (NE dataset too large for "all")
    if (viewMode === "new-assessments") {
      setSelectedTaxa(prev => prev.has("all") ? new Set<string>() : prev);
    }
  }, [viewMode, setSelectedTaxa, setSelectedCategories, setSelectedYearRanges, setSelectedAssessmentYears, setSelectedDescribedYears, setSelectedCountries, setSelectedObsRanges, setSelectedAssessmentCounts, setSelectedSystems, setSelectedPopulationTrends, setSelectedMovementPatterns, setSelectedThreats, setSelectedCriteria, setSelectedHabitat, setHabitatBreadth, setSelectedHabitatImportance, setSelectedHabitatSeasons, setSelectedHabitatSuitability, setEndemicsOnly, setSelectedGrowthForms, setSelectedAssessors, setSelectedReviewers, setSort]);

  // Taxon toggle handler (used by TaxaSummary)
  // Regular click: select only that taxon (or deselect if already sole selection)
  // Cmd/Ctrl+Click on taxon row: multi-select toggle (expands taxa summary to show all rows)
  const handleToggleTaxon = useCallback((taxonId: string, event: React.MouseEvent) => {
    const isMulti = event.metaKey || event.ctrlKey;

    // Clicking a specific taxon row while browsing a country-scoped bare
    // summary table (Country view, one country selected, no taxon picked yet
    // — see TaxaSummary's countryMode rendering) exits to the full charts+
    // species-table view, still scoped to that country (selectedCountries
    // untouched). Atomic (one history push) via exitCountryModeForTaxon, so
    // a single "back" press cleanly restores the Country View landing page
    // instead of layoutMode and taxa unwinding as separate history entries.
    // The "all" row and multi-select (ctrl/cmd-click) cases fall through to
    // the general path below instead — rarer, and "all" isn't a real taxon
    // drill-down (see its own branch just below).
    if (layoutMode === "country" && taxonId !== "all" && !isMulti) {
      exitCountryModeForTaxon(taxonId);
      return;
    }
    if (layoutMode === "country") setLayoutMode(null);

    // "all" row behavior:
    // - If anything is selected (nested view), return to landing page
    // - Only select "all" when clicking from the landing page itself (nothing selected)
    // Disabled in new-assessments mode (NE dataset too large for "all")
    if (taxonId === "all") {
      if (selectedTaxa.size > 0 || selectedSubgroups.size > 0) {
        if (originLayout === "country") {
          // Came from Country View's landing page via a taxon drill-down
          // (exitCountryModeForTaxon) — return there instead of the generic
          // default view. See originLayout's own doc in useFilterParams.ts.
          // fromPopstateRef first: this taxa non-empty→empty transition is
          // part of one atomic, fully-specified navigation (countries stays
          // as-is), not a generic "taxon deselected" — without the ref, the
          // "reset filters on taxa change" effect below would immediately
          // clear the very countries this navigation means to keep (see its
          // own comment on enterCountryDrilldown for the same escape hatch).
          fromPopstateRef.current = true;
          returnToLayoutMode("country");
          return;
        }
        // Return to landing page
        setSelectedSubgroups(new Set());
        setSelectedTaxa(new Set());
        return;
      }
      // On landing page: toggle "all" on/off (disabled in new-assessments — NE dataset too large)
      if (isNewAssessments) return;
      setSelectedTaxa(prev => {
        if (prev.has("all")) return new Set<string>();
        return new Set(["all"]);
      });
      return;
    }

    // Single click on already-sole-selected taxon: keep selected (TaxaSummary
    // handles expand/collapse toggle). Clear search/species if active.
    if (!isMulti && selectedTaxa.size === 1 && selectedTaxa.has(taxonId)) {
      if (searchFilter || urlSpecies != null) {
        clearAllFilters();
      }
      return;
    }

    setSelectedTaxa(prev => {
      if (isMulti) {
        // Remove "all" if present when multi-selecting specific taxa
        const next = new Set(prev);
        next.delete("all");
        if (next.has(taxonId)) {
          next.delete(taxonId);
        } else {
          next.add(taxonId);
        }
        return next;
      }
      // Switching to a different taxon — clear subgroups
      setSelectedSubgroups(new Set());
      return new Set([taxonId]);
    });
  }, [setSelectedTaxa, setSelectedSubgroups, selectedTaxa, selectedSubgroups, isNewAssessments, searchFilter, urlSpecies, clearAllFilters, layoutMode, setLayoutMode, exitCountryModeForTaxon, originLayout, returnToLayoutMode, fromPopstateRef]);

  // Reset all other filters when taxa selection changes
  const prevTaxaRef = useRef(selectedTaxa);
  const skipClearOnTaxaChangeRef = useRef(false);
  useEffect(() => {
    const prev = prevTaxaRef.current;
    prevTaxaRef.current = selectedTaxa;
    // Skip if taxa haven't actually changed (same reference or same contents)
    if (prev === selectedTaxa) return;
    if (prev.size === selectedTaxa.size && [...selectedTaxa].every(t => prev.has(t))) return;
    // Skip clearing when taxa changed as a side-effect of subgroup selection
    if (skipClearOnTaxaChangeRef.current) {
      skipClearOnTaxaChangeRef.current = false;
      return;
    }
    // Skip clearing when the taxa change came from URL navigation (popstate) —
    // the URL already contains the complete state (e.g. from search bar navigation).
    if (fromPopstateRef.current) {
      fromPopstateRef.current = false;
      return;
    }
    // Skip clearing when going from no taxa to some taxa — this happens during
    // URL hydration (useFilterParams starts empty then populates from URL) and
    // there are no taxa-specific filters to reset when nothing was selected before.
    if (prev.size === 0) return;
    clearAllFilters();
    setShowOnlyStarred(false);
  }, [selectedTaxa, clearAllFilters, fromPopstateRef]);

  const [showOnlyStarred, setShowOnlyStarred] = useState(false);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  // Set, not a single string (like expandedCriteria below) — multi-selecting
  // two top-level threats (cmd-click) should show pills below BOTH, not just
  // whichever was clicked last.
  const [expandedThreat, setExpandedThreat] = useState<Set<string>>(new Set());

  // Keep the threats drill-down in sync with the selection. Whenever an expanded
  // top-level category is no longer represented in the selection — because the
  // threats were cleared (Clear all / chip ×), a child was deselected, or the view
  // was reset — collapse that category's pills so no stale level lingers.
  // Independent per category, mirroring expandedCriteria's effect below.
  useEffect(() => {
    setExpandedThreat(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const ec of prev) {
        const stillSelected = Array.from(selectedThreats).some(c => c === ec || c.startsWith(ec + "."));
        if (!stillSelected) { next.delete(ec); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [selectedThreats]);

  // Set, not a single string, so multiple branches can be drilled into and stay open
  // at once (e.g. B1b AND C2a both expanded simultaneously) — needed for proper
  // multi-select across branches; a single "last expanded" value would collapse
  // whichever branch you weren't currently clicking in.
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(new Set());

  // Mirrors the threats drill-down effect above: collapse each expanded branch once
  // it's no longer represented in the selection (independently — clearing one
  // branch's selection doesn't touch another still-selected branch's expansion).
  useEffect(() => {
    setExpandedCriteria(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const ec of prev) {
        const stillSelected = Array.from(selectedCriteria).some(c => c === ec || c.startsWith(ec));
        if (!stillSelected) { next.delete(ec); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [selectedCriteria]);

  // Habitat drill-down — Set-based like expandedThreat above, for the same
  // reason: multi-selecting two top-level habitats should show pills below
  // both.
  const [expandedHabitat, setExpandedHabitat] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedHabitat(prev => {
      let changed = false;
      const next = new Set(prev);
      for (const ec of prev) {
        const stillSelected = Array.from(selectedHabitat).some(c => c === ec || c.startsWith(ec + "."));
        if (!stillSelected) { next.delete(ec); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [selectedHabitat]);

  // Habitat chart pagination — 18 top-level categories is more than
  // comfortably fits in the card's fixed chart height, so page through them
  // (max 10/page) rather than scroll. Clamped inline (not reset via effect)
  // so a shrinking result set after other filters change just lands on the
  // last valid page instead of an empty one.
  const [habitatPage, setHabitatPage] = useState(0);
  const HABITAT_PAGE_SIZE = 10;

  // Assessors/Reviewers chart: one merged, toggleable chart (like an earlier
  // version of this page had) instead of two permanently side-by-side charts
  // — halves the vertical space these together take up, at the cost of one
  // click to see the other list. Local-only UI state, not URL-synced (same as
  // e.g. habitatPage above) since it's a view toggle, not a filter.
  const [assessorReviewerMode, setAssessorReviewerMode] = useState<"assessors" | "reviewers">("assessors");

  // Breadth/Importance/Season/Suitability dropdown menus in the Habitat card header
  // (replacing a wall of individual toggle buttons — Breadth is a single-select
  // Specialist/Generalist choice, Exclude minor a single checkbox, Season a
  // multi-select list of all 5 IUCN values).
  const [habitatBreadthMenuOpen, setHabitatBreadthMenuOpen] = useState(false);
  const [habitatImportanceMenuOpen, setHabitatImportanceMenuOpen] = useState(false);
  const [habitatSeasonMenuOpen, setHabitatSeasonMenuOpen] = useState(false);
  const [habitatSuitabilityMenuOpen, setHabitatSuitabilityMenuOpen] = useState(false);
  const habitatBreadthMenuRef = useRef<HTMLDivElement>(null);
  const habitatImportanceMenuRef = useRef<HTMLDivElement>(null);
  const habitatSeasonMenuRef = useRef<HTMLDivElement>(null);
  const habitatSuitabilityMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!habitatBreadthMenuOpen && !habitatImportanceMenuOpen && !habitatSeasonMenuOpen && !habitatSuitabilityMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (habitatBreadthMenuRef.current && !habitatBreadthMenuRef.current.contains(e.target as Node)) {
        setHabitatBreadthMenuOpen(false);
      }
      if (habitatImportanceMenuRef.current && !habitatImportanceMenuRef.current.contains(e.target as Node)) {
        setHabitatImportanceMenuOpen(false);
      }
      if (habitatSeasonMenuRef.current && !habitatSeasonMenuRef.current.contains(e.target as Node)) {
        setHabitatSeasonMenuOpen(false);
      }
      if (habitatSuitabilityMenuRef.current && !habitatSuitabilityMenuRef.current.contains(e.target as Node)) {
        setHabitatSuitabilityMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [habitatBreadthMenuOpen, habitatImportanceMenuOpen, habitatSeasonMenuOpen, habitatSuitabilityMenuOpen]);

  // Stable callback for debounced search input
  const handleSearch = useCallback((value: string) => {
    setSearchFilter(value);
  }, [setSearchFilter]);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const PAGE_SIZE = pageSize;

  // ── Data fetching ────────────────────────────────────────────────────
  // Species are fetched and cached in the shared SpeciesCacheContext (keyed by
  // the exact request URL, e.g. `/api/redlist/species?taxon=birds`), not local
  // component state — this is what lets compare mode's two panels share a
  // fetch when they pick the same taxon, and it naturally keeps Assessed vs Not
  // Evaluated data for the same taxon separate too, since their URLs differ
  // (`?taxon=birds` vs `?taxon=birds&category=NE`) without needing an explicit
  // mode-prefixed cache key.
  const error = useMemo(() => {
    if (selectedTaxa.size === 0) return null;
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    for (const t of fetchSet) {
      if (isNewAssessments && t === "all") continue;
      const err = cache.errors[speciesApiUrl(t, categoryParam)];
      if (err) return err;
    }
    return null;
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.errors, speciesApiUrl]);

  // Prefetch all species on mount so taxa clicks feel instant (skip for new-assessments — NE
  // dataset too large). Idempotent via the shared cache's request() — a no-op once
  // `?taxon=all` is cached or already in flight (e.g. requested by another compare-mode panel,
  // or by the per-taxon effect below reaching "all" first).
  useEffect(() => {
    if (isNewAssessments) return;
    cache.request(`${SPECIES_API}?taxon=all`);
  // Depends on cache.request specifically, not the whole cache object: the
  // linter conservatively wants the whole object for any method call off a
  // hook-returned value, but cache.request's identity only ever changes
  // together with cache.entries (see SpeciesCacheContext) — depending on the
  // whole object here would additionally re-run this effect on every
  // loadingUrls/errors-only update, e.g. another compare-mode panel's fetch
  // completing or failing, which has nothing to do with this taxon.
  }, [isNewAssessments, cache.request]); // eslint-disable-line react-hooks/exhaustive-deps

  // Determine which taxa need fetching, and request them from the shared cache
  useEffect(() => {
    if (selectedTaxa.size === 0) return;

    // In new-assessments mode, a drill-down fetches the SUB-GROUP directly so a sub-group of
    // a too-large aggregate (e.g. crustaceans under invertebrates, beetles under insects)
    // loads on its own instead of being filtered out of the parent's empty (tooLarge) result.
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0
      ? [...selectedSubgroups]
      : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";

    // If "all" is already cached, no individual fetches needed — "all" data covers everything.
    if (cache.entries[speciesApiUrl("all", categoryParam)] && !selectedTaxa.has("all")) return;

    for (const taxonId of fetchSet) {
      if (isNewAssessments && taxonId === "all") continue; // NE dataset too large for "all"
      cache.request(speciesApiUrl(taxonId, categoryParam));
    }
  // cache.entries (for the "all" fast-path check above) + cache.request
  // specifically, not the whole cache object — see the prefetch effect
  // above for why depending on the whole object over-triggers this.
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.entries, cache.request, speciesApiUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Loading" means one of THIS panel's currently-relevant URLs is still in flight —
  // deliberately not "is anything in the shared cache loading", since in compare mode
  // that set can include requests belonging to the other panel entirely.
  const speciesLoading = useMemo(() => {
    if (selectedTaxa.size === 0) return false;
    const fetchSet = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    return fetchSet.some(t => !(isNewAssessments && t === "all") && cache.loadingUrls.has(speciesApiUrl(t, categoryParam)));
  }, [selectedTaxa, selectedSubgroups, isNewAssessments, cache.loadingUrls, speciesApiUrl]);

  // Merge species from all fetched taxa relevant to current selection
  const assessedSpecies = useMemo(() => {
    if (selectedTaxa.size === 0) return [];
    const categoryParam = isNewAssessments ? "&category=NE" : "";
    // If "all" is cached for this mode, use it directly
    const allEntry = cache.entries[speciesApiUrl("all", categoryParam)];
    if (allEntry) return allEntry.species;
    // In new-assessments mode a drill-down is fetched per sub-group, so merge those caches
    // when sub-groups are selected; otherwise merge the per-taxon caches.
    const sourceIds = isNewAssessments && selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    let merged: RedListSpecies[] = [];
    for (const taxonId of sourceIds) {
      const entry = cache.entries[speciesApiUrl(taxonId, categoryParam)];
      if (entry) merged = merged.concat(entry.species);
    }
    return merged;
  }, [selectedTaxa, selectedSubgroups, cache.entries, isNewAssessments, speciesApiUrl]);

  // assessedSpecies already contains NE species in new-assessments mode (the
  // main fetch above handles that); in Assessed mode it's assessed-only.
  const species = assessedSpecies;

  // Filter by selected taxa + subgroup only — no other filters applied. This is
  // the "true total" baseline the Country map tooltip shows alongside its fully
  // filtered count (see countryStatsForMapTotal below), since every memo past
  // this point narrows further.
  const taxaFilteredSpeciesBase = useMemo(() => {
    let filtered = species;
    // In new-assessments mode with a sub-group selected, species were fetched per sub-group
    // (taxon_id = the sub-group), so the speciesMatchesNode filter below is authoritative —
    // skip the parent taxon_id filter, which would otherwise drop them.
    if (selectedTaxa.size > 0 && !selectedTaxa.has("all") && !(isNewAssessments && selectedSubgroups.size > 0)) {
      // Display-root entries (the 8 taxa) match by taxon_id. Any selected taxon
      // that isn't a taxonomy node — an arbitrary rank like ?taxa=turdidae — is
      // matched against the species' own class/order/family (#261).
      const arbitrary = [...selectedTaxa].filter((t) => t !== "all" && !findNode(t)).map((t) => t.toLowerCase());
      filtered = filtered.filter((s) =>
        (s.taxon_id != null && selectedTaxa.has(s.taxon_id)) ||
        (arbitrary.length > 0 && arbitrary.some((v) =>
          (s.class_name ?? "").toLowerCase() === v ||
          (s.order_name ?? "").toLowerCase() === v ||
          (s.family ?? "").toLowerCase() === v)),
      );
    }
    if (selectedSubgroups.size > 0) {
      filtered = filtered.filter(s =>
        Array.from(selectedSubgroups).some(sg => speciesMatchesNode(s, sg))
      );
    }
    // Narrow to one breakdown row from a described-species popover (bd= URL param —
    // see TaxaSummary.tsx's BreakdownList). Gated on the filter's own nodeId still
    // being selected: a stale bd= surviving a later, unrelated navigation (any
    // setSelectedSubgroups/setSelectedTaxa call resets it, but this is a second,
    // cheap line of defense) becomes inert instead of silently hiding every species.
    if (breakdownFilter && selectedSubgroups.has(breakdownFilter.nodeId)) {
      filtered = filtered.filter(s => matchesBreakdownName(s, breakdownFilter.rank, breakdownFilter.name, breakdownFilter.nodeId));
      // CoL Match / No CoL Match split within this name's Assessed count (only
      // meaningful for assessed species, which is all `species` is in reassessments
      // mode — the id lists are only ever sent alongside view=reassessments).
      if (breakdownFilter.onlyIds?.length) {
        const ids = new Set(breakdownFilter.onlyIds);
        filtered = filtered.filter(s => s.sis_taxon_id != null && ids.has(s.sis_taxon_id));
      } else if (breakdownFilter.excludeIds?.length) {
        const ids = new Set(breakdownFilter.excludeIds);
        filtered = filtered.filter(s => s.sis_taxon_id == null || !ids.has(s.sis_taxon_id));
      }
    }
    return filtered;
  }, [species, selectedTaxa, selectedSubgroups, isNewAssessments, breakdownFilter]);

  // Exact URL-only base filters (obs / assessment-year / described-year bounds —
  // outdated is applied separately below, not here). Applied here on the base set
  // so every chart AND the table inherit them — and identically to the bucket-free
  // /browse + MCP query, which is what makes an agent's dashboard link reproduce
  // the same species set. Mirrors species-filter numeric bounds.
  const taxaFilteredSpeciesExceptOutdated = useMemo(() => {
    let filtered = taxaFilteredSpeciesBase;
    const { minObs, maxObs, minAssessmentYear, maxAssessmentYear, minDescribedYear, maxDescribedYear } = exactFilters;
    if (minObs != null || maxObs != null) {
      filtered = filtered.filter(s => {
        const obs = s.gbif_occurrence_count ?? 0;
        return (minObs == null || obs >= minObs) && (maxObs == null || obs <= maxObs);
      });
    }
    if (minAssessmentYear != null || maxAssessmentYear != null) {
      filtered = filtered.filter(s => {
        const y = s.assessment_date ? parseInt(s.assessment_date.slice(0, 4), 10) : NaN;
        if (Number.isNaN(y)) return false;
        return (minAssessmentYear == null || y >= minAssessmentYear) && (maxAssessmentYear == null || y <= maxAssessmentYear);
      });
    }
    if (minDescribedYear != null || maxDescribedYear != null) {
      filtered = filtered.filter(s =>
        s.described_year != null
        && (minDescribedYear == null || s.described_year >= minDescribedYear)
        && (maxDescribedYear == null || s.described_year <= maxDescribedYear));
    }
    return filtered;
  }, [taxaFilteredSpeciesBase, exactFilters]);

  // Outdated is excluded from taxaFilteredSpeciesExceptOutdated (above) so the
  // Range/Year chart (which shares this same "when was this species assessed"
  // dimension) can show the full distribution and mute — not remove — bars that
  // don't match the Outdated toggle, mirroring how the Conservation Status chart
  // mutes bars for selectedCategories rather than dropping them. Every other
  // memo/the table uses this outdated-filtered version, so the Outdated button
  // behaves like a real, dashboard-wide filter everywhere except its own chart.
  const taxaFilteredSpecies = useMemo(() => {
    if (!exactFilters.outdated) return taxaFilteredSpeciesExceptOutdated;
    const wantOutdated = exactFilters.outdated === "yes";
    return taxaFilteredSpeciesExceptOutdated.filter(s => isOutdated(s.assessment_date, dataAsOf) === wantOutdated);
  }, [taxaFilteredSpeciesExceptOutdated, exactFilters.outdated, dataAsOf]);

  // Helper to check if species matches year range filter
  const matchesYearRangeFilter = useCallback((assessmentDate: string | null, yearRanges: Set<string> = selectedYearRanges): boolean => {
    if (yearRanges.size === 0) return true;
    if (!assessmentDate) return false;
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const yearsSince = (Date.now() - new Date(assessmentDate).getTime()) / msPerYear;
    for (const range of yearRanges) {
      switch (range) {
        case "<1 year": if (yearsSince < 1) return true; break;
        case "1-5 years": if (yearsSince >= 1 && yearsSince < 5) return true; break;
        case "5-10 years": if (yearsSince >= 5 && yearsSince < 10) return true; break;
        case "10-20 years": if (yearsSince >= 10 && yearsSince < 20) return true; break;
        case "20+ years": if (yearsSince >= 20) return true; break;
      }
    }
    return false;
  }, [selectedYearRanges]);

  // Helper to check if species matches specific assessment year(s) filter
  const matchesAssessmentYearFilter = useCallback((assessmentDate: string | null, years: Set<string> = selectedAssessmentYears): boolean => {
    if (years.size === 0) return true;
    if (!assessmentDate) return false;
    const year = String(new Date(assessmentDate).getFullYear());
    return years.has(year);
  }, [selectedAssessmentYears]);

  // Helper to check if species matches GBIF observation range filter
  const matchesObsRangeFilter = useCallback((obsCount: number | null | undefined, obsRanges: Set<string> = selectedObsRanges): boolean => {
    if (obsRanges.size === 0) return true;
    const obs = obsCount ?? 0;
    for (const range of obsRanges) {
      switch (range) {
        case "0": if (obs === 0) return true; break;
        case "1-10": if (obs >= 1 && obs <= 10) return true; break;
        case "11-100": if (obs >= 11 && obs <= 100) return true; break;
        case "101-1K": if (obs >= 101 && obs <= 1000) return true; break;
        case "1K-10K": if (obs >= 1001 && obs <= 10000) return true; break;
        case "10K+": if (obs > 10000) return true; break;
      }
    }
    return false;
  }, [selectedObsRanges]);

  // Bucket a species' assessment_count into a chart-bar label. 5+ collapses the
  // long tail (a handful of species have 8-9 historical assessments) into one bar.
  const assessmentCountBucket = useCallback((count: number | null | undefined): string => {
    const n = count ?? 1;
    return n >= 5 ? "5+" : String(n);
  }, []);

  // Helper to check if species matches the number-of-assessments filter (#423 item 1)
  const matchesAssessmentCountFilter = useCallback((count: number | null | undefined, counts: Set<string> = selectedAssessmentCounts): boolean => {
    if (counts.size === 0) return true;
    return counts.has(assessmentCountBucket(count));
  }, [selectedAssessmentCounts, assessmentCountBucket]);

  // CoL description-year range bucket for a species (NE/new-assessments only).
  // "Unknown" covers names CoL has no datable source for (chiefly plants/fungi,
  // whose author citations omit the year and lack a dated reference).
  const describedYearBucket = useCallback((year: number | null | undefined): string => {
    if (year == null) return "Unknown";
    if (year < 1900) return "pre-1900";
    if (year < 1950) return "1900-1949";
    if (year < 2000) return "1950-1999";
    if (year < 2010) return "2000-2009";
    if (year < 2020) return "2010-2019";
    return "2020+";
  }, []);

  // Helper to check if species matches the described-year bucket filter
  const matchesDescribedYearFilter = useCallback((year: number | null | undefined, buckets: Set<string> = selectedDescribedYears): boolean => {
    if (buckets.size === 0) return true;
    return buckets.has(describedYearBucket(year));
  }, [selectedDescribedYears, describedYearBucket]);

  // Assessors/reviewers from the latest assessment. These are denormalized inline
  // on the species list (latest_assessors/latest_reviewers) so the filter works
  // without the full history array (which is fetched lazily for the detail panel).
  const getSpeciesAssessors = useCallback((s: Species): string[] => {
    return parseAssessors(s.latest_assessors);
  }, []);

  const getSpeciesReviewers = useCallback((s: Species): string[] => {
    return parseAssessors(s.latest_reviewers);
  }, []);

  // Track which view is active in the years-since-assessed chart ("range" buckets vs specific year).
  // Defaults to "year" when a specific-year filter is already active (e.g. from URL).
  const [yearsChartMode, setYearsChartMode] = useState<"range" | "year">(
    () => (selectedAssessmentYears.size > 0 ? "year" : "range")
  );
  // If the URL hydrates with specific years selected after mount, surface the year view.
  useEffect(() => {
    if (selectedAssessmentYears.size > 0) {
      setYearsChartMode("year");
    }
  }, [selectedAssessmentYears]);
  // Paginate the by-year chart: show 10 years at a time, defaulting to the most recent
  const YEARS_PAGE_SIZE = 10;
  const [yearsPage, setYearsPage] = useState(0);

  // Helper to check if species matches the assessors filter.
  // Case-insensitive SUBSTRING match — same semantics as the /browse + MCP
  // `assessors` filter, so an agent's dashboard link reproduces the same set.
  // (A chart click adds a full name, which substring-matches itself; the only
  // difference is the rare case where one full name is a substring of another.)
  const matchesAssessorsFilter = useCallback((s: Species): boolean => {
    if (selectedAssessors.size === 0) return true;
    const sels = [...selectedAssessors].map(x => x.toLowerCase());
    return getSpeciesAssessors(s).some(a => { const al = a.toLowerCase(); return sels.some(x => al.includes(x)); });
  }, [selectedAssessors, getSpeciesAssessors]);

  // Helper to check if species matches the reviewers filter (substring, as above).
  const matchesReviewersFilter = useCallback((s: Species): boolean => {
    if (selectedReviewers.size === 0) return true;
    const sels = [...selectedReviewers].map(x => x.toLowerCase());
    return getSpeciesReviewers(s).some(r => { const rl = r.toLowerCase(); return sels.some(x => rl.includes(x)); });
  }, [selectedReviewers, getSpeciesReviewers]);

  // Consolidates all 5 habitat-related filters into one predicate (rather than 5
  // separate inline checks repeated at every filter site) since major/resident both
  // need the full parsed entry list, not just codes — cheaper to parse once per
  // species per call than to re-derive it 2-3x over.
  // The specialists/exclude-minor/season/suitability logic itself lives in
  // @/lib/habitat-filter (a pure function, unit tested) — this just binds it to
  // the component's current filter state.
  const matchesHabitatFilter = useCallback((s: Species): boolean =>
    matchesHabitatCriteria(s.habitat_codes, {
      selectedHabitat,
      breadth: habitatBreadth,
      importance: selectedHabitatImportance,
      seasons: selectedHabitatSeasons,
      suitability: selectedHabitatSuitability,
    }),
  [selectedHabitat, habitatBreadth, selectedHabitatImportance, selectedHabitatSeasons, selectedHabitatSuitability]);

  // Species details cache (images, criteria, common names)
  const [speciesDetails, setSpeciesDetails] = useState<Record<number, SpeciesDetails>>({});
  // Lazy assessment-history cache, keyed by sis_taxon_id. The species list no
  // longer carries the full history array; it's fetched when a detail row opens.
  const [assessmentHistory, setAssessmentHistory] = useState<Record<number, Species["previous_assessments"]>>({});
  // Catalogue of Life synonyms for the open species (detail panel's CoL tab), fetched lazily.
  type SynInfo = { col_id: string | null; accepted_name: string | null; accepted_authorship: string | null; synonyms: { name: string; authorship: string | null; status: string }[] };
  const [synonymsBySpecies, setSynonymsBySpecies] = useState<Record<string, SynInfo>>({});

  // Row expansion state (initialized from URL params if present)
  const [selectedSpeciesKey, setSelectedSpeciesKeyRaw] = useState<number | null>(urlSpecies != null && isNewAssessments ? Math.abs(urlSpecies) : urlSpecies);
  const [activeDetailTab, setActiveDetailTabRaw] = useState<"gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol">(urlTab ?? "gbif");
  // Track which tabs have been visited so we only mount (and fetch data for) a tab on first click
  const [visitedTabs, setVisitedTabs] = useState<Set<string>>(new Set([urlTab ?? "gbif"]));
  const urlSpeciesHandledRef = useRef(false);
  // Track whether a tab change was initiated programmatically (click) vs URL navigation (popstate)
  const programmaticTabChangeRef = useRef(false);
  // Whether the user has explicitly picked a tab for the currently open species.
  // When the occurrence tab turns up no records for a not-evaluated species we
  // auto-switch to Catalogue of Life — but only while the user hasn't chosen a tab.
  const manualTabSelectionRef = useRef(false);
  // Guards the auto-switch so it fires at most once per opened species.
  const autoColSwitchedRef = useRef(false);

  // Wrap setters to sync with URL
  const setSelectedSpeciesKey = useCallback((key: number | null) => {
    setSelectedSpeciesKeyRaw(key);
    setSpeciesParam(key, key != null ? "gbif" : "gbif");
    if (key != null) {
      setActiveDetailTabRaw("gbif");
      setVisitedTabs(new Set(["gbif"]));
      manualTabSelectionRef.current = false;
      autoColSwitchedRef.current = false;
    }
  }, [setSpeciesParam]);

  const setActiveDetailTab = useCallback((tab: "gbif" | "literature" | "redlist" | "wikipedia" | "cites" | "assessors" | "reviewers" | "col" | "eol", isManual = true) => {
    setActiveDetailTabRaw(tab);
    programmaticTabChangeRef.current = true;
    if (isManual) manualTabSelectionRef.current = true;
    setTabParam(tab);
    setVisitedTabs(prev => {
      if (prev.has(tab)) return prev;
      const next = new Set(prev);
      next.add(tab);
      return next;
    });
  }, [setTabParam]);

  // When the occurrence tab (GBIF + iNat) reports no records for a not-evaluated
  // species, fall back to the Catalogue of Life tab — unless the user has already
  // navigated to a tab themselves.
  const handleOccurrenceEmpty = useCallback(() => {
    if (manualTabSelectionRef.current || autoColSwitchedRef.current) return;
    autoColSwitchedRef.current = true;
    setActiveDetailTab("col", false);
  }, [setActiveDetailTab]);
  // Sync species/tab from URL params (fires on popstate, e.g. back/forward or search bar navigation)
  // In new-assessments mode, row keys use Math.abs(id) so selectedSpeciesKey must match.
  useEffect(() => {
    if (urlSpecies != null) {
      // Skip visitedTabs reset for programmatic (click) tab changes – only reset on URL navigation
      if (programmaticTabChangeRef.current) {
        programmaticTabChangeRef.current = false;
        return;
      }
      setSelectedSpeciesKeyRaw(isNewAssessments ? Math.abs(urlSpecies) : urlSpecies);
      setActiveDetailTabRaw(urlTab ?? "gbif");
      setVisitedTabs(new Set([urlTab ?? "gbif"]));
      // A tab pinned in the URL counts as an explicit choice, so don't auto-switch.
      manualTabSelectionRef.current = urlTab != null && urlTab !== "gbif";
      autoColSwitchedRef.current = false;
      urlSpeciesHandledRef.current = false; // allow auto-page-navigate for new species
    }
  }, [urlSpecies, urlTab, isNewAssessments]);

  // Single-species fast path: use cached search result to render the detail panel
  // immediately without waiting for the bulk table to load.
  const [singleSpeciesPreview, setSingleSpeciesPreview] = useState<RedListSpecies | null>(null);
  useEffect(() => {
    if (urlSpecies == null) {
      setSingleSpeciesPreview(null);
      return;
    }
    // Skip if species is already in bulk-loaded data
    const bulkTaxon = selectedTaxa.size === 1 ? [...selectedTaxa][0] : "all";
    const bulkUrl = speciesApiUrl(bulkTaxon, isNewAssessments ? "&category=NE" : "");
    const allSpecies = cache.entries[bulkUrl]?.species ?? [];
    if (allSpecies.some(s => s.id === urlSpecies)) {
      setSingleSpeciesPreview(null);
      return;
    }

    // Use cached search result to construct preview (no API call needed)
    const cached = getLastSearchResult();
    if (cached && cached.id === urlSpecies) {
      clearLastSearchResult();
      setSingleSpeciesPreview({
        id: cached.id,
        sis_taxon_id: cached.id > 0 ? cached.id : null,
        assessment_id: cached.assessment_id,
        scientific_name: cached.scientific_name,
        common_name: cached.common_name,
        family: null,
        category: cached.category,
        assessment_date: cached.assessment_date,
        year_published: null,
        population_trend: null,
        countries: cached.countries,
        class_name: null,
        order_name: null,
        taxon_group: cached.taxon_group,
        taxon_id: cached.taxon_id,
        described_year: null,
        gbif_species_key: cached.gbif_species_key,
        gbif_occurrence_count: null,
        gbif_observations_after_assessment_year: null,
        latest_assessors: null,
        latest_reviewers: null,
        previous_assessments: [],
        systems: [],
        growth_forms: [],
        movement_pattern: null,
        possibly_extinct: false,
        possibly_extinct_in_the_wild: false,
        criteria: null,
        threat_codes: [],
        habitat_codes: [],
        assessment_count: null,
      });
      urlSpeciesHandledRef.current = true;
    }
  }, [urlSpecies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear preview once the species appears in bulk-loaded data
  useEffect(() => {
    if (!singleSpeciesPreview) return;
    if (assessedSpecies.some(s => s.id === singleSpeciesPreview.id)) {
      setSingleSpeciesPreview(null);
    }
  }, [assessedSpecies, singleSpeciesPreview]);

  const [mounted, setMounted] = useState(false);


  // Pinned species as ordered array (persisted to localStorage)
  const [pinnedSpecies, setPinnedSpecies] = useState<number[]>([]);
  const pinnedSet = useMemo(() => new Set(pinnedSpecies), [pinnedSpecies]); // For O(1) lookup

  // Drag state for reordering pinned species
  const [draggedSpecies, setDraggedSpecies] = useState<number | null>(null);
  const [dragOverSpecies, setDragOverSpecies] = useState<number | null>(null);

  const pinnedStorageKey = isNewAssessments ? "new-assessments-pinned-species" : "redlist-pinned-species";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load pinned species from localStorage (re-load when viewMode changes)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(pinnedStorageKey);
      setPinnedSpecies(stored ? JSON.parse(stored) : []);
    } catch {
      setPinnedSpecies([]);
    }
  }, [pinnedStorageKey]);

  // Save pinned species to localStorage
  const savePinnedSpecies = (newPinned: number[]) => {
    setPinnedSpecies(newPinned);
    try {
      localStorage.setItem(pinnedStorageKey, JSON.stringify(newPinned));
    } catch {
      // Ignore localStorage errors
    }
  };

  // Toggle pin status
  const togglePinned = (speciesId: number) => {
    if (pinnedSet.has(speciesId)) {
      savePinnedSpecies(pinnedSpecies.filter(id => id !== speciesId));
    } else {
      savePinnedSpecies([...pinnedSpecies, speciesId]);
    }
  };

  // Drag handlers for reordering
  const handleDragStart = (e: React.DragEvent, speciesId: number) => {
    if (!pinnedSet.has(speciesId)) return;
    setDraggedSpecies(speciesId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, speciesId: number) => {
    e.preventDefault();
    if (!draggedSpecies || !pinnedSet.has(speciesId)) return;
    setDragOverSpecies(speciesId);
  };

  const handleDragLeave = () => {
    setDragOverSpecies(null);
  };

  const handleDrop = (e: React.DragEvent, targetId: number) => {
    e.preventDefault();
    if (!draggedSpecies || draggedSpecies === targetId) {
      setDraggedSpecies(null);
      setDragOverSpecies(null);
      return;
    }

    const draggedIdx = pinnedSpecies.indexOf(draggedSpecies);
    const targetIdx = pinnedSpecies.indexOf(targetId);

    if (draggedIdx === -1 || targetIdx === -1) {
      setDraggedSpecies(null);
      setDragOverSpecies(null);
      return;
    }

    // Reorder the array
    const newPinned = [...pinnedSpecies];
    newPinned.splice(draggedIdx, 1);
    newPinned.splice(targetIdx, 0, draggedSpecies);
    savePinnedSpecies(newPinned);

    setDraggedSpecies(null);
    setDragOverSpecies(null);
  };

  const handleDragEnd = () => {
    setDraggedSpecies(null);
    setDragOverSpecies(null);
  };

  // ── Cross-filter chart data (client-computed) ────────────────────────

  const matchesSearch = useCallback((s: Species) => {
    if (!searchFilter) return true;
    return s.scientific_name.toLowerCase().includes(searchFilter) ||
      !!s.common_name?.toLowerCase().includes(searchFilter);
  }, [searchFilter]);

  // Category chart: apply all filters EXCEPT category
  const categoryDataWithPercent = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.category] = (counts[s.category] || 0) + 1;
    });
    const DISPLAY_ORDER = ["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD"];
    const total = DISPLAY_ORDER.reduce((sum, code) => sum + (counts[code] || 0), 0);
    return DISPLAY_ORDER.map(code => ({
      code,
      name: code,
      count: counts[code] || 0,
      color: CATEGORY_COLORS[code] || "#999",
      percent: total > 0 ? (((counts[code] || 0) / total) * 100).toFixed(1) : "0",
      label: `${(counts[code] || 0).toLocaleString()} (${total > 0 ? (((counts[code] || 0) / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Year chart: apply all filters EXCEPT year range AND outdated (see
  // taxaFilteredSpeciesExceptOutdated above) — buckets align exactly with the
  // isOutdated() threshold (>10 years) so the Outdated toggle mutes rather than
  // zeroes out the buckets that don't match.
  const assessmentYearData = useMemo(() => {
    const now = Date.now();
    const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
    const ranges = [
      { range: "<1 year", shortRange: "<1y", count: 0, minYear: 0 },
      { range: "1-5 years", shortRange: "1-5y", count: 0, minYear: 1 },
      { range: "5-10 years", shortRange: "5-10y", count: 0, minYear: 5 },
      { range: "10-20 years", shortRange: "10-20y", count: 0, minYear: 10 },
      { range: "20+ years", shortRange: ">20y", count: 0, minYear: 20 },
    ];
    taxaFilteredSpeciesExceptOutdated.forEach(s => {
      if (!s.assessment_date || s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const yearsSince = (now - new Date(s.assessment_date).getTime()) / msPerYear;
      if (yearsSince < 1) ranges[0].count++;
      else if (yearsSince < 5) ranges[1].count++;
      else if (yearsSince < 10) ranges[2].count++;
      else if (yearsSince < 20) ranges[3].count++;
      else ranges[4].count++;
    });
    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    return ranges.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpeciesExceptOutdated, selectedCategories, selectedCountries, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter]);

  // Assessments-by-year chart: apply all filters EXCEPT the year-based ones
  // (selectedYearRanges, selectedAssessmentYears) AND outdated. The Range bucket
  // chart and the Year chart share a single cross-filter facet ("when was this
  // species assessed"), so we exclude selectedYearRanges/selectedAssessmentYears
  // here — the by-year chart should always show the full timeline so users can
  // switch/expand their year selection regardless of what they picked in the
  // range view, and vice-versa — and we exclude outdated for the same reason
  // isOutdated is excluded from assessmentYearData above.
  const assessmentYearsByYearData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpeciesExceptOutdated.forEach(s => {
      if (!s.assessment_date || s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const year = String(new Date(s.assessment_date).getFullYear());
      counts[year] = (counts[year] || 0) + 1;
    });
    const total = Object.values(counts).reduce((sum, c) => sum + c, 0);
    // Sort years ascending so the horizontal chart reads chronologically (oldest → newest)
    return Object.entries(counts)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([year, count]) => ({
        code: year,
        count,
        label: `${count.toLocaleString()} (${total > 0 ? ((count / total) * 100).toFixed(1) : 0}%)`,
      }));
  }, [taxaFilteredSpeciesExceptOutdated, selectedCategories, selectedCountries, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter]);

  const yearsTotalPages = Math.max(1, Math.ceil(assessmentYearsByYearData.length / YEARS_PAGE_SIZE));
  const paginatedAssessmentYearsData = useMemo(
    () => assessmentYearsByYearData.slice(yearsPage * YEARS_PAGE_SIZE, (yearsPage + 1) * YEARS_PAGE_SIZE),
    [assessmentYearsByYearData, yearsPage]
  );
  // Global max across all years so the Y-axis scale stays fixed as users page
  const yearsGlobalMax = useMemo(
    () => assessmentYearsByYearData.reduce((m, d) => Math.max(m, d.count), 0),
    [assessmentYearsByYearData]
  );

  // Jump to the most recent page when Year view is first entered — either on
  // the initial mount (when the URL already selects a specific year) or on the
  // Range → Year toggle. A ref initialized to `null` detects "never been in
  // year view before". Unrelated cross-filter changes that reshape
  // yearsTotalPages don't teleport the user, because this effect only fires
  // its body on the transition, not on every dataset update.
  const prevYearsChartModeRef = useRef<"range" | "year" | null>(null);
  useEffect(() => {
    if (yearsChartMode === "year" && prevYearsChartModeRef.current !== "year") {
      setYearsPage(Math.max(0, yearsTotalPages - 1));
    }
    prevYearsChartModeRef.current = yearsChartMode;
  }, [yearsChartMode, yearsTotalPages]);
  // Clamp yearsPage into the valid range when the dataset shrinks beneath it,
  // but preserve the user's current page otherwise so cross-filter tweaks
  // don't bounce them away from the years they were browsing.
  useEffect(() => {
    if (yearsPage > yearsTotalPages - 1) {
      setYearsPage(Math.max(0, yearsTotalPages - 1));
    }
  }, [yearsPage, yearsTotalPages]);

  // GBIF observations chart: apply all filters EXCEPT obs range
  const gbifObsData = useMemo(() => {
    const ranges = [
      { range: "0", shortRange: "0", count: 0 },
      { range: "1-10", shortRange: "1-10", count: 0 },
      { range: "11-100", shortRange: "11-100", count: 0 },
      { range: "101-1K", shortRange: "101-1K", count: 0 },
      { range: "1K-10K", shortRange: "1K-10K", count: 0 },
      { range: "10K+", shortRange: "10K+", count: 0 },
    ];
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const obs = s.gbif_occurrence_count ?? 0;
      if (obs === 0) ranges[0].count++;
      else if (obs <= 10) ranges[1].count++;
      else if (obs <= 100) ranges[2].count++;
      else if (obs <= 1000) ranges[3].count++;
      else if (obs <= 10000) ranges[4].count++;
      else ranges[5].count++;
    });
    const total = ranges.reduce((sum, r) => sum + r.count, 0);
    return ranges.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Number of Assessments chart (#423 item 1): apply all filters EXCEPT the
  // assessment-count selection itself. NE species have no assessment history
  // (assessment_count is null) so they're excluded, same as other
  // assessment-only charts.
  const assessmentCountData = useMemo(() => {
    const buckets = [
      { range: "1", shortRange: "1", count: 0 },
      { range: "2", shortRange: "2", count: 0 },
      { range: "3", shortRange: "3", count: 0 },
      { range: "4", shortRange: "4", count: 0 },
      { range: "5+", shortRange: "5+", count: 0 },
    ];
    const byBucket: Record<string, number> = { "1": 0, "2": 1, "3": 2, "4": 3, "5+": 4 };
    taxaFilteredSpecies.forEach(s => {
      if (s.category === "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      buckets[byBucket[assessmentCountBucket(s.assessment_count)]].count++;
    });
    const total = buckets.reduce((sum, r) => sum + r.count, 0);
    return buckets.map(r => ({
      ...r,
      label: `${r.count.toLocaleString()} (${total > 0 ? ((r.count / total) * 100).toFixed(1) : 0}%)`,
    }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedAssessmentYears, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesYearRangeFilter, matchesAssessmentYearFilter, matchesObsRangeFilter, assessmentCountBucket]);

  // Year Described chart (NE / new-assessments only): per-bucket counts, cross-filtered
  // by every OTHER active filter (search, country, GBIF obs) but NOT the described-year
  // selection itself. Only NE rows carry described_year; in new-assessments all rows are NE.
  const describedYearData = useMemo(() => {
    const buckets = ["pre-1900", "1900-1949", "1950-1999", "2000-2009", "2010-2019", "2020+", "Unknown"];
    const counts: Record<string, number> = Object.fromEntries(buckets.map(b => [b, 0]));
    taxaFilteredSpecies.forEach(s => {
      if (s.category !== "NE") return;
      if (!matchesSearch(s)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (!matchesObsRangeFilter(s.gbif_occurrence_count)) return;
      counts[describedYearBucket(s.described_year)]++;
    });
    const total = buckets.reduce((sum, b) => sum + counts[b], 0);
    return buckets
      .map(b => ({
        range: b,
        shortRange: b,
        count: counts[b],
        label: `${counts[b].toLocaleString()} (${total > 0 ? ((counts[b] / total) * 100).toFixed(1) : 0}%)`,
      }))
      .filter(d => d.count > 0);
  }, [taxaFilteredSpecies, selectedCountries, matchesSearch, matchesObsRangeFilter, describedYearBucket]);

  // Country chart: apply all filters EXCEPT country
  const { countryStatsForMap } = useMemo(() => {
    const counts: Record<string, number> = {};
    const outdatedCounts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      // Gated on NE the same way the assessment-year filters above are, since NE species have no assessment.
      const outdated = s.category !== "NE" && isOutdated(s.assessment_date, dataAsOf);
      s.countries.forEach(code => {
        counts[code] = (counts[code] || 0) + 1;
        if (outdated) outdatedCounts[code] = (outdatedCounts[code] || 0) + 1;
      });
    });
    const sorted = Object.entries(counts)
      .sort((a, b) => {
        const nameA = ALPHA2_TO_NAME[a[0]] || a[0];
        const nameB = ALPHA2_TO_NAME[b[0]] || b[0];
        return nameA.localeCompare(nameB);
      })
      .map(([code]) => code);
    const statsForMap = Object.fromEntries(
      Object.entries(counts).map(([code, count]) => [
        code,
        { occurrences: 0, species: count, outdated: outdatedCounts[code] || 0 }
      ])
    );
    return { countryCounts: counts, uniqueCountries: sorted, countryStatsForMap: statsForMap };
  }, [taxaFilteredSpecies, selectedCategories, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter, dataAsOf]);

  // True per-country totals — taxon/subgroup selection only, no other filters —
  // so the Country map tooltip can show "142 of 3,847 total" instead of just
  // "142" when a filter (e.g. Outdated, a category) narrows the country's
  // species count. Without this, e.g. "% Outdated: 100%" while the Outdated
  // toggle is on reads as a fact about the country instead of a tautology.
  const countryStatsForMapTotal = useMemo(() => {
    const counts: Record<string, number> = {};
    const outdatedCounts: Record<string, number> = {};
    taxaFilteredSpeciesBase.forEach(s => {
      const outdated = s.category !== "NE" && isOutdated(s.assessment_date, dataAsOf);
      s.countries.forEach(code => {
        counts[code] = (counts[code] || 0) + 1;
        if (outdated) outdatedCounts[code] = (outdatedCounts[code] || 0) + 1;
      });
    });
    return Object.fromEntries(
      Object.entries(counts).map(([code, count]) => [
        code,
        { occurrences: 0, species: count, outdated: outdatedCounts[code] || 0 }
      ])
    );
  }, [taxaFilteredSpeciesBase, dataAsOf]);

  // Realm counts: apply all filters EXCEPT systems (for realm button tooltips)
  const realmCounts = useMemo(() => {
    const counts: Record<string, number> = { Terrestrial: 0, Freshwater: 0, Marine: 0 };
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      for (const sys of s.systems ?? []) {
        if (sys in counts) counts[sys]++;
      }
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Population trend counts: apply all filters EXCEPT population trend
  const populationTrendCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!s.population_trend) return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.population_trend] = (counts[s.population_trend] || 0) + 1;
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Movement pattern counts: apply all filters EXCEPT movement pattern
  const movementPatternCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!s.movement_pattern) return;
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      counts[s.movement_pattern] = (counts[s.movement_pattern] || 0) + 1;
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedThreats, selectedCriteria, matchesHabitatFilter, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, endemicsOnly, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedGrowthForms, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Threat counts: apply all filters EXCEPT threats (count species per prefix, deduplicated)
  // Threat counts per code, plus the denominator (`threatTotal`) for percentages:
  // every in-view species that passes the same filters, with or without a threat
  // coded. The threat *selection* is intentionally excluded here, so both the
  // counts and the percentage stay stable as threats are clicked.
  const { threatCounts, threatTotal } = useMemo(() => {
    const counts: Record<string, number> = {};
    let total = 0;
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      total++;
      if (!s.threat_codes?.length) return;
      // Deduplicate: count each prefix at most once per species
      const counted = new Set<string>();
      for (const tc of s.threat_codes) {
        const parts = tc.split(".");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join(".");
          if (!counted.has(prefix)) {
            counted.add(prefix);
            counts[prefix] = (counts[prefix] || 0) + 1;
          }
        }
      }
    });
    return { threatCounts: counts, threatTotal: total };
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedCriteria, matchesHabitatFilter, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Criteria counts: apply all filters EXCEPT criteria (count species per code — at every
  // depth: letter, number, sub-clause, roman numeral — deduplicated per species) — mirrors
  // threatCounts/threatTotal above. parseCriteriaCodes already returns the full set of codes
  // a species satisfies at every level (e.g. ["B1","B1a","B1b","B1b(iii)"]); the top-level
  // letter's own count is derived separately here (via `letters`) rather than reusing a
  // same-named code, since D/E's bare letter ("D") is otherwise indistinguishable from a
  // "number" level entry and would double-count.
  const criteriaCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      const codes = parseCriteriaCodes(s.criteria);
      const letters = new Set(codes.map(c => c[0]));
      // Bare-letter codes (D, E — no trailing digit) ARE the top-level letter, so
      // skip them here to avoid double-counting against the `letters` loop below.
      for (const code of codes) if (code.length > 1) counts[code] = (counts[code] || 0) + 1;
      for (const letter of letters) counts[letter] = (counts[letter] || 0) + 1;
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, matchesHabitatFilter, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Habitat counts: apply all filters EXCEPT habitat (all 4 dimensions — code
  // selection, specialists/major/resident toggles — so the drill-down counts and
  // toggle buttons show what WOULD match if clicked, not what already does).
  // Distinct codes per species are prefix-counted the same way threatCounts does
  // (both are "." hierarchical), deduplicated so a species with both "1.1" and
  // "1.2" only counts once toward top-level "1".
  const habitatCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesReviewersFilter(s)) return;
      // selectedHabitat itself is excluded from this cross-filter (so every bar
      // stays visible to compare against, even once one is picked) but Breadth/
      // Importance/Season are refinements, not "the axis being explored" —
      // they DO narrow these counts, same as any other active filter.
      const entries = parseHabitatEntries(s.habitat_codes);
      if (entries.length === 0) return;
      const codes = Array.from(new Set(entries.map(e => e.code)));
      if (habitatBreadth) {
        const known = coarseKnownCategories(codes);
        if (habitatBreadth === "specialist" && known.size !== 1) return;
        if (habitatBreadth === "generalist" && known.size < 2) return;
      }
      const counted = new Set<string>();
      for (const code of codes) {
        const parts = code.split(".");
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join(".");
          if (counted.has(prefix)) continue;
          // Importance/Season/Suitability are checked against entries belonging to
          // THIS bar's category specifically — e.g. with "Not major" unchecked, the
          // Forest bar only counts species whose Forest entry (not some other
          // habitat of theirs) is confirmed non-minor.
          if (habitatImportanceActive || habitatSeasonsActive || habitatSuitabilityActive) {
            const relevantForPrefix = entries.filter(e => e.code === prefix || e.code.startsWith(prefix + "."));
            if (habitatImportanceActive && !relevantForPrefix.some(e => selectedHabitatImportance.has(e.importance))) continue;
            if (habitatSeasonsActive && !relevantForPrefix.some(e => selectedHabitatSeasons.has(e.season))) continue;
            if (habitatSuitabilityActive && !relevantForPrefix.some(e => selectedHabitatSuitability.has(e.suitability))) continue;
          }
          counted.add(prefix);
          counts[prefix] = (counts[prefix] || 0) + 1;
        }
      }
    });
    return counts;
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesSearch, matchesAssessorsFilter, matchesReviewersFilter, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter, habitatBreadth, selectedHabitatImportance, selectedHabitatSeasons, selectedHabitatSuitability, habitatImportanceActive, habitatSeasonsActive, habitatSuitabilityActive]);

  // Handle region filter — select all countries in the chosen region
  const handleRegionFilter = useCallback((region: string) => {
    if (!region) {
      setSelectedCountries(new Set());
      return;
    }
    setSelectedCountries(new Set(iucnRegionCountries(region)));
  }, [setSelectedCountries]);

  // Assessor chart: apply all filters EXCEPT assessors (include reviewers)
  const assessorChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (!matchesHabitatFilter(s)) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesReviewersFilter(s)) return;
      const assessors = getSpeciesAssessors(s);
      for (const a of assessors) {
        counts[a] = (counts[a] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        code: name,
        count,
        label: count.toLocaleString(),
      }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesReviewersFilter, getSpeciesAssessors, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // Reviewer chart: apply all filters EXCEPT reviewers (include assessors)
  const reviewerChartData = useMemo(() => {
    const counts: Record<string, number> = {};
    taxaFilteredSpecies.forEach(s => {
      if (!matchesSearch(s)) return;
      if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
      if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
      if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
      if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
      if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
      if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
      if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
      if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
      if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
      if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
      if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
      if (endemicsOnly && s.countries.length !== 1) return;
      if (selectedGrowthForms.size > 0 && !s.growth_forms?.some(gf => selectedGrowthForms.has(gf))) return;
      if (!matchesAssessorsFilter(s)) return;
      if (!matchesHabitatFilter(s)) return;
      const reviewers = getSpeciesReviewers(s);
      for (const r of reviewers) {
        counts[r] = (counts[r] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({
        code: name,
        count,
        label: count.toLocaleString(),
      }));
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedYearRanges, selectedObsRanges, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, matchesSearch, matchesAssessorsFilter, getSpeciesReviewers, matchesObsRangeFilter, selectedAssessmentCounts, matchesAssessmentCountFilter, matchesYearRangeFilter, selectedAssessmentYears, matchesAssessmentYearFilter]);

  // ── Client-side filtering and sorting ──────────────────────────────
  const { filteredSpecies, sortedSpecies } = useMemo(() => {
    const CATEGORY_ORDER: Record<string, number> = {
      EX: 0, EW: 1, CR: 2, EN: 3, VU: 4, NT: 5, LC: 6, DD: 7, NE: 8,
    };
    const filtered = taxaFilteredSpecies.filter((s) => {
      const matchesCategory = selectedCategories.size === 0 || selectedCategories.has(s.category);
      const matchesYear = s.category === "NE" || (matchesYearRangeFilter(s.assessment_date) && matchesAssessmentYearFilter(s.assessment_date));
      // Described-year applies to NE rows only (the only ones carrying described_year).
      const matchesDescribed = s.category !== "NE" || matchesDescribedYearFilter(s.described_year);
      const matchesObs = matchesObsRangeFilter(s.gbif_occurrence_count);
      const matchesAssessmentCount = matchesAssessmentCountFilter(s.assessment_count);
      const matchesCountry = selectedCountries.size === 0 || s.countries.some(c => selectedCountries.has(c));
      const matchesSystem = selectedSystems.size === 0 || s.systems?.some(sys => selectedSystems.has(sys));
      const matchesTrend = selectedPopulationTrends.size === 0 || (s.population_trend != null && selectedPopulationTrends.has(s.population_trend));
      const matchesMovement = selectedMovementPatterns.size === 0 || (s.movement_pattern != null && selectedMovementPatterns.has(s.movement_pattern));
      const matchesThreat = selectedThreats.size === 0 || s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")));
      const matchesCriteria = selectedCriteria.size === 0 || parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)));
      const matchesHabitat = matchesHabitatFilter(s);
      const matchesEndemic = !endemicsOnly || s.countries.length === 1;
      const matchesGrowth = selectedGrowthForms.size === 0 || s.growth_forms?.some(gf => selectedGrowthForms.has(gf));
      const matchesSearch =
        !searchFilter ||
        s.scientific_name.toLowerCase().includes(searchFilter) ||
        s.common_name?.toLowerCase().includes(searchFilter);
      const matchesAssessor = matchesAssessorsFilter(s);
      const matchesReviewer = matchesReviewersFilter(s);
      const pinnedKey = isNewAssessments ? Math.abs(s.id) : s.sis_taxon_id;
      const matchesStarred = !showOnlyStarred || (pinnedKey != null && pinnedSet.has(pinnedKey));
      return matchesCategory && matchesYear && matchesDescribed && matchesObs && matchesAssessmentCount && matchesCountry && matchesSystem && matchesTrend && matchesMovement && matchesThreat && matchesCriteria && matchesHabitat && matchesEndemic && matchesGrowth && matchesSearch && matchesAssessor && matchesReviewer && matchesStarred;
    });

    const sorted = [...filtered].sort((a, b) => {
      if (showOnlyStarred) {
        const aKey = isNewAssessments ? Math.abs(a.id) : a.sis_taxon_id;
        const bKey = isNewAssessments ? Math.abs(b.id) : b.sis_taxon_id;
        if (aKey != null && bKey != null) {
          const aIdx = pinnedSpecies.indexOf(aKey);
          const bIdx = pinnedSpecies.indexOf(bKey);
          if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
        }
      }

      let comparison = 0;
      if (isNewAssessments && !sortField) {
        // Default sort for new-assessments: by total GBIF desc
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else if (!sortField || sortField === "year") {
        const dateA = a.assessment_date ? new Date(a.assessment_date).getTime() : 0;
        const dateB = b.assessment_date ? new Date(b.assessment_date).getTime() : 0;
        comparison = dateA - dateB;
      } else if (sortField === "category") {
        comparison = (CATEGORY_ORDER[a.category] ?? 99) - (CATEGORY_ORDER[b.category] ?? 99);
      } else if (sortField === "totalGbif") {
        comparison = (a.gbif_occurrence_count ?? -1) - (b.gbif_occurrence_count ?? -1);
      } else if (sortField === "newGbif") {
        comparison = (a.gbif_observations_after_assessment_year ?? -1) - (b.gbif_observations_after_assessment_year ?? -1);
      } else if (sortField === "pctNewGbif") {
        const pctA = (a.gbif_occurrence_count && a.gbif_occurrence_count > 0 && a.gbif_observations_after_assessment_year != null)
          ? a.gbif_observations_after_assessment_year / a.gbif_occurrence_count : -1;
        const pctB = (b.gbif_occurrence_count && b.gbif_occurrence_count > 0 && b.gbif_observations_after_assessment_year != null)
          ? b.gbif_observations_after_assessment_year / b.gbif_occurrence_count : -1;
        comparison = pctA - pctB;
      } else if (sortField === "describedYear") {
        // Nulls (no known year) sort to the bottom regardless of direction below.
        comparison = (a.described_year ?? -1) - (b.described_year ?? -1);
      }

      // Apply primary sort direction
      const primary = sortDirection === "asc" ? comparison : -comparison;
      if (primary !== 0) return primary;

      // Secondary sort: total GBIF desc (always, regardless of primary direction)
      const gbifCmp = (b.gbif_occurrence_count ?? -1) - (a.gbif_occurrence_count ?? -1);
      if (gbifCmp !== 0) return gbifCmp;

      // Tertiary tiebreaker: stable ID order
      return (a.sis_taxon_id ?? a.id) - (b.sis_taxon_id ?? b.id);
    });

    return { filteredSpecies: filtered, sortedSpecies: sorted };
  }, [taxaFilteredSpecies, selectedCategories, selectedCountries, selectedSystems, selectedPopulationTrends, selectedMovementPatterns, selectedThreats, selectedCriteria, matchesHabitatFilter, endemicsOnly, selectedGrowthForms, searchFilter, showOnlyStarred, pinnedSet, pinnedSpecies, sortField, sortDirection, matchesAssessorsFilter, matchesReviewersFilter, isNewAssessments, matchesObsRangeFilter, matchesAssessmentCountFilter, matchesYearRangeFilter, matchesAssessmentYearFilter, matchesDescribedYearFilter]);

  // Giant aggregates (insects, invertebrates…) are capped at 400k server-side; surface
  // a banner so the list reads as "showing N of M — drill into a sub-group for the rest".
  const neTruncation = useMemo(() => {
    if (!isNewAssessments) return null;
    let truncated = false; let neTotal = 0; let shown = 0;
    for (const t of selectedTaxa) {
      const info = cache.entries[speciesApiUrl(t, "&category=NE")];
      if (info?.truncated) { truncated = true; neTotal += info.neTotal ?? 0; shown += info.species.length; }
    }
    return truncated ? { neTotal, shown } : null;
  }, [isNewAssessments, selectedTaxa, cache.entries, speciesApiUrl]);

  // A giant aggregate (insects, invertebrates) exceeds the cap — the API returns no rows
  // and flags tooLarge. Don't render the charts/list; prompt a drill-down into a sub-group.
  // Only applies with no sub-group selected (sub-groups are always under the cap).
  const neTooLarge = useMemo(() => {
    if (!isNewAssessments) return null;
    // Reflect the actually-fetched target: a selected sub-group (e.g. insects under
    // invertebrates) if any, otherwise the top-level taxon. So a too-large sub-group shows
    // the drill-down prompt while a manageable sibling (crustaceans, beetles) loads.
    const targets = selectedSubgroups.size > 0 ? [...selectedSubgroups] : [...selectedTaxa];
    const names: string[] = [];
    let neTotal = 0;
    for (const t of targets) {
      const info = cache.entries[speciesApiUrl(t, "&category=NE")];
      if (info?.tooLarge) { names.push(findNode(t)?.name ?? t); neTotal += info.neTotal ?? 0; }
    }
    return names.length > 0 ? { names, neTotal } : null;
  }, [isNewAssessments, selectedTaxa, selectedSubgroups, cache.entries, speciesApiUrl]);

  // ── Client-side pagination ─────────────────────────────────────────
  const totalFiltered = filteredSpecies.length;
  const totalPages = Math.ceil(sortedSpecies.length / PAGE_SIZE);
  const paginatedSpeciesBase = sortedSpecies.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  // Include single-species preview at the top of the page when bulk data hasn't loaded yet
  const paginatedSpecies = useMemo(() => {
    if (!singleSpeciesPreview) return paginatedSpeciesBase;
    // De-dupe by id, and (for NE search results, whose cached-preview id differs from the
    // loaded NE row's synthetic id) also by scientific name — so a searched CoL species
    // shows the loaded row once the list arrives, not a duplicate alongside the preview.
    if (paginatedSpeciesBase.some(s =>
      s.id === singleSpeciesPreview.id ||
      (singleSpeciesPreview.category === "NE" && s.scientific_name === singleSpeciesPreview.scientific_name)
    )) return paginatedSpeciesBase;
    return [singleSpeciesPreview, ...paginatedSpeciesBase];
  }, [paginatedSpeciesBase, singleSpeciesPreview]);

  // ── Single species mode: show info card instead of charts ──────────
  // Only activate when arrived via the main search bar (which sets the
  // `species` URL param). Filters that incidentally narrow results to one
  // species should keep showing the regular charts view.
  const isSingleSpecies = filteredSpecies.length === 1 && urlSpecies != null;
  const singleSpecies = isSingleSpecies ? filteredSpecies[0] : null;
  const singleSpeciesAssessors = useMemo(() => singleSpecies ? getSpeciesAssessors(singleSpecies) : [], [singleSpecies, getSpeciesAssessors]);
  const singleSpeciesReviewers = useMemo(() => singleSpecies ? getSpeciesReviewers(singleSpecies) : [], [singleSpecies, getSpeciesReviewers]);

  // Helper to get country display name
  const getCountryName = (code: string) => ALPHA2_TO_NAME[code] || code;

  // Map selection handlers (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleCountrySelect = (countryCode: string, _countryName: string, event: React.MouseEvent) => {
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedCountries(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(countryCode)) next.delete(countryCode);
        else next.add(countryCode);
        return next;
      } else {
        if (prev.size === 1 && prev.has(countryCode)) return new Set();
        return new Set([countryCode]);
      }
    });
  };



  // Handle sort toggle
  const handleSort = (field: "year" | "category" | "totalGbif" | "newGbif" | "pctNewGbif" | "describedYear") => {
    const currentField = sortField === null ? "year" : sortField;
    if (currentField === field) {
      if (sortDirection === "desc") {
        setSort(field, "asc");
      } else {
        setSort(null, "desc");
      }
    } else {
      setSort(field, "desc");
    }
    setCurrentPage(1);
  };

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [selectedTaxa, selectedCategories, selectedYearRanges, selectedAssessmentYears, selectedDescribedYears, selectedObsRanges, selectedAssessors, selectedReviewers, searchFilter, selectedCountries, showOnlyStarred]);

  // Auto-navigate to the page containing the URL-selected species
  useEffect(() => {
    if (urlSpeciesHandledRef.current || selectedSpeciesKey == null || sortedSpecies.length === 0) return;
    const idx = sortedSpecies.findIndex(s => {
      const key = isNewAssessments ? Math.abs(s.id) : (s.sis_taxon_id ?? s.gbif_species_key ?? s.id);
      return key === selectedSpeciesKey;
    });
    if (idx >= 0) {
      const page = Math.floor(idx / PAGE_SIZE) + 1;
      setCurrentPage(page);
      urlSpeciesHandledRef.current = true;
    }
  }, [sortedSpecies, selectedSpeciesKey, isNewAssessments, PAGE_SIZE]);

  // Populate basic speciesDetails from DB data (GBIF counts instant, no API calls)
  // inatDefaultImage / openAlexPaperCount / papersAtAssessment are left as undefined → spinner
  useEffect(() => {
    const newDetails: Record<number, SpeciesDetails> = {};
    for (const s of paginatedSpecies) {
      if (speciesDetails[s.id]) continue; // Already have details

      if (s.gbif_species_key) {
        newDetails[s.id] = {
          criteria: null,
          commonName: s.common_name || null,
          gbifUrl: `https://www.gbif.org/species/${s.gbif_species_key}`,
          gbifOccurrences: s.gbif_occurrence_count ?? null,
          gbifOccurrencesSinceAssessment: s.gbif_observations_after_assessment_year ?? null,
          gbifMatchStatus: { matchType: 'EXACT' },
          inatDefaultImage: undefined, // Loading — fetched per-page below
        };
      } else {
        newDetails[s.id] = {
          criteria: null,
          commonName: s.common_name || null,
          gbifUrl: null,
          gbifOccurrences: null,
          gbifOccurrencesSinceAssessment: null,
          gbifMatchStatus: { matchType: 'NONE' },
          inatDefaultImage: undefined, // Loading
        };
      }
    }
    if (Object.keys(newDetails).length > 0) {
      setSpeciesDetails((prev) => ({ ...prev, ...newDetails }));
    }
  }, [paginatedSpecies, speciesDetails]);

  // Fetch iNat profile pic for visible species (lightweight per-page calls)
  // Also resolve GBIF match status for species not found in CSV (HIGHERRANK vs NONE)
  useEffect(() => {
    const speciesToFetch = paginatedSpecies.filter(
      (s) => {
        const d = speciesDetails[s.id];
        // Fetch if we have basic details but inatDefaultImage is still undefined (not yet fetched)
        return d && d.inatDefaultImage === undefined;
      }
    );
    if (speciesToFetch.length === 0) return;

    const controller = new AbortController();
    const { signal } = controller;

    async function fetchLightweightDetails() {
      const promises = speciesToFetch.map(async (s) => {
        try {
          // Build parallel fetch list: iNat image + GBIF match check for species not in CSV
          const fetchPromises: [Promise<Response>, Promise<Response | null>] = [
            // Proxied through our own API route (not called directly against
            // iNaturalist) so the edge cache is shared across visitors
            // instead of every browser re-fetching the same species fresh.
            fetch(
              `/api/inat/thumbnail?name=${encodeURIComponent(s.scientific_name)}`,
              { signal }
            ),
            // Check GBIF match status for species missing from CSV
            !s.gbif_species_key
              ? fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(s.scientific_name)}`, { signal })
              : Promise.resolve(null),
          ];

          const [inatRes, gbifMatchRes] = await Promise.all(fetchPromises);

          let inatDefaultImage: InatDefaultImage | null = null;
          if (inatRes.ok) {
            const inatData = await inatRes.json();
            inatDefaultImage = inatData.inatDefaultImage || null;
          }

          let gbifMatchStatus: GbifMatchStatus | null = null;
          if (gbifMatchRes?.ok) {
            const gbifMatch = await gbifMatchRes.json();
            gbifMatchStatus = {
              matchType: gbifMatch.matchType || 'NONE',
              matchedName: gbifMatch.scientificName,
              matchedRank: gbifMatch.rank,
            };
          }

          return { id: s.id, inatDefaultImage, gbifMatchStatus };
        } catch {
          return { id: s.id, inatDefaultImage: null, gbifMatchStatus: null };
        }
      });

      const results = await Promise.all(promises);
      if (signal.aborted) return;

      const updates: Record<number, Partial<SpeciesDetails>> = {};
      for (const r of results) {
        updates[r.id] = {
          inatDefaultImage: r.inatDefaultImage,
          gbifMatchFetched: true,
          ...(r.gbifMatchStatus ? { gbifMatchStatus: r.gbifMatchStatus } : {}),
        };
      }
      setSpeciesDetails((prev) => {
        const next = { ...prev };
        for (const [id, update] of Object.entries(updates)) {
          const numId = Number(id);
          if (next[numId]) {
            next[numId] = { ...next[numId], ...update };
          }
        }
        return next;
      });
    }

    fetchLightweightDetails();
    return () => controller.abort("cleanup");
  }, [paginatedSpecies, speciesDetails]);

  // Fetch IUCN criteria on row expansion (lightweight — no GBIF calls; the map handles those)
  useEffect(() => {
    if (!selectedSpeciesKey) return;
    const s = paginatedSpecies.find((sp) => sp.id === selectedSpeciesKey);
    if (!s || s.category === "NE") return;
    const existing = speciesDetails[s.id];
    if (!existing || existing.criteriaFetched) return;

    async function fetchCriteria() {
      if (!s || !s.assessment_id) return;
      try {
        const res = await fetch(
          `/api/redlist/assessment/${s.assessment_id}`
        );
        if (res.ok) {
          const data = await res.json();
          setSpeciesDetails((prev) => ({
            ...prev,
            [s.id]: {
              ...prev[s.id],
              criteria: data.criteria || null,
              criteriaFetched: true,
            },
          }));
        }
      } catch {
        // Ignore errors
      }
    }

    fetchCriteria();
  }, [selectedSpeciesKey, paginatedSpecies, speciesDetails]);

  // Lazily fetch the full assessment history for the open species (the list
  // carries only the latest assessors/reviewers; the history array is fetched
  // here on demand for the Red List Assessments tab).
  useEffect(() => {
    if (!selectedSpeciesKey) return;
    const s = paginatedSpecies.find((sp) => sp.id === selectedSpeciesKey);
    const sis = s?.sis_taxon_id;
    if (!s || s.category === "NE" || !sis || assessmentHistory[sis]) return;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/redlist/species/history?id=${sis}`);
        if (res.ok) {
          const data = await res.json();
          if (!aborted) setAssessmentHistory((prev) => ({ ...prev, [sis]: data.previous_assessments ?? [] }));
        }
      } catch {
        // Ignore — the panel falls back to an empty history.
      }
    })();
    return () => { aborted = true; };
  }, [selectedSpeciesKey, paginatedSpecies, assessmentHistory]);

  // Lazily fetch CoL synonyms for the open species — only once the CoL tab is opened.
  // Keyed by col_id (NE rows carry it) or sis_taxon_id (assessed, resolved server-side).
  const synKey = useCallback((s: Species | undefined): string | null =>
    s?.col_id ? `col:${s.col_id}` : (s?.sis_taxon_id != null ? `sis:${s.sis_taxon_id}` : null), []);
  useEffect(() => {
    if (selectedSpeciesKey == null || !visitedTabs.has("col")) return;
    const s = paginatedSpecies.find((sp) => (isNewAssessments ? Math.abs(sp.id) : sp.id) === selectedSpeciesKey);
    const key = synKey(s);
    if (!s || !key || synonymsBySpecies[key]) return;
    const qs = s.col_id ? `col=${encodeURIComponent(s.col_id)}` : `sis=${s.sis_taxon_id}`;
    let aborted = false;
    (async () => {
      try {
        const res = await fetch(`/api/redlist/synonyms?${qs}`);
        if (res.ok) { const data = await res.json(); if (!aborted) setSynonymsBySpecies((prev) => ({ ...prev, [key]: data })); }
      } catch { /* panel falls back to empty */ }
    })();
    return () => { aborted = true; };
  }, [selectedSpeciesKey, visitedTabs, paginatedSpecies, isNewAssessments, synonymsBySpecies, synKey]);

  // Handle category bar click (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleCategoryClick = (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const code = data.payload?.code;
    if (!code) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedCategories(prev => {
      if (isMultiSelect) {
        // Toggle in/out of set
        const next = new Set(prev);
        if (next.has(code)) {
          next.delete(code);
        } else {
          next.add(code);
        }
        return next;
      } else {
        // Single select: toggle off if already selected, otherwise replace
        if (prev.size === 1 && prev.has(code)) {
          return new Set();
        }
        return new Set([code]);
      }
    });
  };

  // Whether the current selection is exactly the "Threatened" set (CR, EN, VU)
  const isThreatenedSelected =
    selectedCategories.size === THREATENED_CATEGORIES.length &&
    THREATENED_CATEGORIES.every((c) => selectedCategories.has(c));

  // "Threatened" shortcut: select CR, EN and VU at once (toggle off if already exactly that set)
  const handleThreatenedClick = () => {
    setSelectedCategories(isThreatenedSelected ? new Set() : new Set<string>(THREATENED_CATEGORIES));
  };

  // "Outdated" shortcut: filter to species assessed >10 years ago (mirrors isOutdated in species-store.ts)
  const isOutdatedSelected = exactFilters.outdated === "yes";
  const handleOutdatedClick = () => {
    setExactFilters({ outdated: isOutdatedSelected ? null : "yes" });
  };

  // Mutes (doesn't remove) the Range/Year chart bars that don't match the Outdated
  // toggle — mirrors how selectedCategories mutes bars in the Conservation Status
  // chart rather than dropping them. An actual bar click (selectedYearRanges) takes
  // priority if present, since that's a more specific user choice.
  const yearRangeSelectedItems = useMemo(() => {
    if (selectedYearRanges.size > 0) return selectedYearRanges;
    if (!exactFilters.outdated) return selectedYearRanges;
    return new Set(
      exactFilters.outdated === "yes"
        ? ["10-20 years", "20+ years"]
        : ["<1 year", "1-5 years", "5-10 years"]
    );
  }, [selectedYearRanges, exactFilters.outdated]);

  // Same idea for the by-year chart — a whole calendar year is treated as
  // "outdated" if it's on or before the cutoff year (coarser than the precise
  // isOutdated() threshold, since this chart only has year-level granularity).
  const assessmentYearSelectedItems = useMemo(() => {
    if (selectedAssessmentYears.size > 0) return selectedAssessmentYears;
    if (!exactFilters.outdated) return selectedAssessmentYears;
    const cutoffYear = outdatedCutoffDate(dataAsOf).getFullYear();
    const wantOutdated = exactFilters.outdated === "yes";
    const matching = new Set<string>();
    assessmentYearsByYearData.forEach(d => {
      const isYearOutdated = Number(d.code) <= cutoffYear;
      if (isYearOutdated === wantOutdated) matching.add(d.code);
    });
    return matching;
  }, [selectedAssessmentYears, exactFilters.outdated, assessmentYearsByYearData, dataAsOf]);

  // Handle year range bar click (Cmd/Ctrl+click for multi-select, regular click replaces)
  const handleYearClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedYearRanges(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) {
          next.delete(range);
        } else {
          next.add(range);
        }
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) {
          return new Set();
        }
        return new Set([range]);
      }
    });
  };

  // Handle specific assessment year bar click (Cmd/Ctrl+click for multi-select)
  const handleAssessmentYearClick = (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const year = data.payload?.code;
    if (!year) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedAssessmentYears(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(year)) next.delete(year);
        else next.add(year);
        return next;
      } else {
        if (prev.size === 1 && prev.has(year)) return new Set();
        return new Set([year]);
      }
    });
  };
  // Handle GBIF observation range bar click
  const handleObsClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedObsRanges(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) next.delete(range);
        else next.add(range);
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) return new Set();
        return new Set([range]);
      }
    });
  };

  // Handle Number of Assessments bar click
  const handleAssessmentCountClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedAssessmentCounts(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) next.delete(range);
        else next.add(range);
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) return new Set();
        return new Set([range]);
      }
    });
  };

  // "Reassessed" shortcut (#423 item 1): one click selects every bucket >= 2,
  // flagging species that have been reassessed at least once (1+ reassessment
  // = 2+ total assessments). Toggling off clears the selection entirely,
  // mirroring the Outdated shortcut.
  const REASSESSED_BUCKETS = ["2", "3", "4", "5+"];
  const isReassessedSelected = REASSESSED_BUCKETS.every(b => selectedAssessmentCounts.has(b)) && selectedAssessmentCounts.size === REASSESSED_BUCKETS.length;
  const handleReassessedClick = () => {
    setSelectedAssessmentCounts(isReassessedSelected ? new Set() : new Set(REASSESSED_BUCKETS));
  };

  // Handle Year Described bucket bar click
  const handleDescribedYearClick = (data: { payload?: { range?: string } }, event: React.MouseEvent) => {
    const range = data.payload?.range;
    if (!range) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setSelectedDescribedYears(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(range)) next.delete(range);
        else next.add(range);
        return next;
      } else {
        if (prev.size === 1 && prev.has(range)) return new Set();
        return new Set([range]);
      }
    });
  };

  // Assessors and reviewers each get their own chart, so the click/toggle
  // handlers are parameterised by which selection setter they target.
  type SetSelection = React.Dispatch<React.SetStateAction<Set<string>>>;

  // Toggle a single assessor/reviewer in/out of selection (used by search list)
  const makeAssessorToggle = useCallback((setter: SetSelection) => (code: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }, []);

  // Handle assessor/reviewer bar click
  const makeAssessorClick = useCallback((setter: SetSelection) => (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
    const code = data.payload?.code;
    if (!code) return;
    const isMultiSelect = event.metaKey || event.ctrlKey;
    setter(prev => {
      if (isMultiSelect) {
        const next = new Set(prev);
        if (next.has(code)) next.delete(code);
        else next.add(code);
        return next;
      } else {
        if (prev.size === 1 && prev.has(code)) return new Set();
        return new Set([code]);
      }
    });
  }, []);

  const currentYear = new Date().getFullYear();
  const GBIF_FILTERS = "has_coordinate=true&has_geospatial_issue=false&basis_of_record=HUMAN_OBSERVATION&basis_of_record=MACHINE_OBSERVATION&basis_of_record=OCCURRENCE&basis_of_record=MATERIAL_SAMPLE&basis_of_record=OBSERVATION";
  const isNE = (s: Species) => s.category === "NE";

  // GBIF occurrence counts aren't filterable per-country/category/etc. — only show
  // that color/list column when no filter narrower than "a whole top-level taxon"
  // is active. Shared by both WorldMap instances (the always-visible Country chart
  // and the promoted country-view landing page) so they never disagree.
  const showGbifToggle =
    selectedSubgroups.size === 0
    && [...selectedTaxa].every(id => id in TAXA_BY_ID)
    && selectedCategories.size === 0
    && selectedYearRanges.size === 0
    && selectedAssessmentYears.size === 0
    && selectedObsRanges.size === 0
    && selectedAssessmentCounts.size === 0
    && selectedCountries.size === 0
    && selectedSystems.size === 0
    && selectedPopulationTrends.size === 0
    && selectedMovementPatterns.size === 0
    && selectedThreats.size === 0
    && selectedCriteria.size === 0
    && selectedHabitat.size === 0
    && !habitatBreadth
    && !habitatImportanceActive
    && !habitatSeasonsActive
    && !habitatSuitabilityActive
    && selectedGrowthForms.size === 0
    && selectedAssessors.size === 0
    && selectedReviewers.size === 0
    && !endemicsOnly
    && !searchFilter
    && !showOnlyStarred;

  // Any countries selected anywhere (not just via the Country view landing
  // page) scope TaxaSummary's own fetches too — clicking a country on the
  // normal "Charts row 2" map already narrowed every other chart/table; this
  // closes the one remaining inconsistency (the taxa tree staying global). One
  // country, a whole region, or an arbitrary multi-select are all just "the
  // set of currently selected countries" — the live per-country query counts
  // each species once regardless of how many of these codes it matches (see
  // country-taxa-summary-duckdb.ts's countriesWhere), so there's no reason to
  // special-case region vs. multi-select here.
  const countryScope = selectedCountries.size > 0 ? [...selectedCountries] : null;

  // Country view's own map click select — click-only (no hover preview: the
  // table only appears once a country is actually locked in, so scanning the
  // map with the mouse never itself changes what's shown below it). A plain
  // click always REPLACES the selection with just that country (clicking a
  // second country swaps to it, it doesn't add to the first) — except
  // clicking the already-sole-selected country again clears back to the
  // empty/map-only state. Only ctrl/cmd-click builds a multi-select, toggling
  // a country in/out of the set regardless of what's already selected.
  // Routed through enterCountryDrilldown so the country change stays atomic
  // with clearing taxa/subgroups (see its own comment).
  const handleCountryDrilldown = useCallback(
    (code: string, _name: string, event: React.MouseEvent) => {
      const isMultiSelect = event.metaKey || event.ctrlKey;
      enterCountryDrilldown(prev => {
        if (isMultiSelect) {
          const next = new Set(prev);
          if (next.has(code)) next.delete(code);
          else next.add(code);
          return next;
        }
        if (prev.size === 1 && prev.has(code)) return new Set();
        return new Set([code]);
      });
    },
    [enterCountryDrilldown]
  );

  // Pill removal (✕ button / Clear all) always removes just that one country
  // regardless of how many are selected — unlike a map click, it's never a
  // "replace the whole selection" gesture, so it can't reuse
  // handleCountryDrilldown's replace-on-plain-click semantics.
  const handleCountryRemove = useCallback(
    (code: string) => {
      enterCountryDrilldown(prev => {
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
    },
    [enterCountryDrilldown]
  );

  // Country view's own per-country stats — a small precomputed, all-species
  // aggregate (see data/country-stats.json), fetched once and cached for the
  // session, NOT the client-side countryStatsForMap used elsewhere (that one
  // requires the currently-browsed taxon's full species array to already be
  // loaded, which is fine when you're already browsing e.g. Mammals for other
  // reasons, but would mean downloading the entire "All Species" dataset just
  // to show the landing map — multi-second blank-map delay for no reason,
  // since this data never varies by taxon selection on the landing page).
  const [countryLandingStats, setCountryLandingStats] = useState<CountryStats | null>(null);
  useEffect(() => {
    if (layoutMode !== "country" || countryLandingStats) return;
    fetch("/api/redlist/country-stats")
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.stats) return;
        const shaped: CountryStats = {};
        for (const [code, s] of Object.entries(data.stats as Record<string, { species: number; outdated: number }>)) {
          shaped[code] = { occurrences: 0, species: s.species, outdated: s.outdated };
        }
        setCountryLandingStats(shaped);
      })
      .catch(() => {});
  }, [layoutMode, countryLandingStats]);

  // Country view landing page content — a promoted WorldMap (its own Map/List
  // toggle applies here too), passed into TaxaSummary rather than duplicating a
  // second dynamic-import + prop-wiring of WorldMap there. Region-select
  // behaves the same as the normal "Charts row 2" map below: a region just
  // selects all its countries at once (handleRegionFilter), same as any other
  // multi-country selection. No endemics toggle here — the country-scoped
  // taxa summary is a live per-country DuckDB query that doesn't take an
  // endemics parameter, so the button would have nothing to actually filter.
  // Before countryLandingStats has actually arrived, don't mount WorldMap at
  // all — passing it an empty stats object rendered every country in its
  // no-data (white) fill for a beat before the real colors popped in. A
  // spinner card matching WorldMap's own root sizing (h-full flex-1 min-h-0)
  // avoids any layout jump when it's swapped in for the real map.
  const countryModeContent = countryLandingStats ? (
    <WorldMap
      selectedCountries={selectedCountries}
      onCountrySelect={handleCountryDrilldown}
      precomputedStats={countryLandingStats}
      selectedTaxa={selectedTaxa}
      speciesLabel={isNewAssessments ? "# Unassessed" : undefined}
      showOutdatedMode={!isNewAssessments}
      showGbifToggle={false}
      onRegionFilter={handleRegionFilter}
      mapViewMode={mapViewMode}
      onMapViewModeChange={setMapViewMode}
      mapSortKey={mapSortKey}
      mapSortDirection={mapSortDirection}
      onMapSortChange={setMapSort}
    />
  ) : (
    <div className="relative bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-3 h-full flex-1 min-h-0 flex flex-col items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );

  // Selection chips — rendered by TaxaSummary in a dedicated row of its own,
  // above the table, once at least one country is locked in (the table only
  // mounts once something's selected — see TaxaSummary's countryScoped
  // gate). One chip per selected country (not collapsed into a region name,
  // unlike the atop-table "France ×" chip elsewhere), each individually
  // removable via handleCountryRemove, plus "Clear all" once there's more
  // than one.
  const countryPillsContent = selectedCountries.size > 0 && (
    <div className="flex flex-wrap items-center gap-1.5">
      {[...selectedCountries]
        .map(code => ({ code, name: ALPHA2_TO_NAME[code] ?? code }))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ code, name }) => (
          <span
            key={code}
            className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300 max-w-full"
          >
            <span className="truncate">{name}</span>
            <button
              onClick={() => handleCountryRemove(code)}
              className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              title={`Remove ${name}`}
            >
              ✕
            </button>
          </span>
        ))}
      {selectedCountries.size > 1 && (
        <button
          onClick={() => enterCountryDrilldown(new Set())}
          className="text-sm text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 underline transition-colors"
        >
          Clear all
        </button>
      )}
    </div>
  );

  // Country map card — shared between Charts row 2 (new-assessments mode) and
  // More Filters (reassessments mode, moved there to keep the primary view
  // focused on Conservation Status / Years Since Assessed / Geospatial GBIF
  // Records; see the More Filters section below).
  const countryMapCard = (
    <div>
      {speciesLoading && assessedSpecies.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 min-h-[320px] flex flex-col">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Country
            </h2>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <Spinner />
          </div>
        </div>
      ) : (
        <WorldMap
          selectedCountries={selectedCountries}
          onCountrySelect={handleCountrySelect}
          precomputedStats={countryStatsForMap}
          precomputedStatsTotal={countryStatsForMapTotal}
          selectedTaxa={selectedTaxa}
          speciesLabel={isNewAssessments ? "# Unassessed" : undefined}
          showOutdatedMode={!isNewAssessments}
          showColorModeDropdown={!isNewAssessments}
          onRegionFilter={handleRegionFilter}
          endemicsOnly={endemicsOnly}
          onEndemicsToggle={isNewAssessments ? undefined : () => setEndemicsOnly(!endemicsOnly)}
          showGbifToggle={showGbifToggle}
          mapViewMode={mapViewMode}
          onMapViewModeChange={setMapViewMode}
          mapSortKey={mapSortKey}
          mapSortDirection={mapSortDirection}
          onMapSortChange={setMapSort}
        />
      )}
    </div>
  );

  // Shared by Criteria/Threats/Habitat (#436 follow-up): renders a bar chart
  // with pills inserted directly below whichever bar(s) are currently
  // expanded, instead of a separate section below the WHOLE chart. Splits
  // `data` into segments at each expanded item's position — one FilterBarChart
  // per segment — with that item's pills sandwiched right after its own
  // segment. Each segment sizes to its own bar count (no fixed height/scroll);
  // the card just grows to fit, since drill-down height is now unpredictable
  // (could land after any bar, not just "below everything"). Criteria can have
  // multiple simultaneously-expanded top-level letters (Set-based), so this
  // produces more than 2 segments in that case; Threats/Habitat only ever
  // have one expanded category, so at most 2.
  type DrilldownBarDatum = { code: string; rawCode: string; count: number; label: string };
  function renderInlineDrilldown(
    data: DrilldownBarDatum[],
    isExpanded: (rawCode: string) => boolean,
    renderPills: (rawCode: string) => React.ReactNode,
    chartProps: Omit<React.ComponentProps<typeof FilterBarChart>, "data">,
    // Per-row pixel height. Default (22) is Threats/Habitat's original sizing;
    // Criteria passes 32 to match Number of Assessments' bar thickness, since
    // that chart sits fixed at 170px for its always-5 buckets (170/5 = 34px
    // slot, minus FilterBarChart's internal 5px top/bottom margins = 32px).
    rowHeight = 22
  ): React.ReactNode {
    const segments: { bars: DrilldownBarDatum[]; pillsAfter: string | null }[] = [];
    let current: DrilldownBarDatum[] = [];
    for (const item of data) {
      current.push(item);
      if (isExpanded(item.rawCode)) {
        segments.push({ bars: current, pillsAfter: item.rawCode });
        current = [];
      }
    }
    if (current.length > 0) segments.push({ bars: current, pillsAfter: null });
    // Each segment is a separate <FilterBarChart>, so without a shared xAxisMax
    // every segment auto-scales its bars to its OWN local max count — the
    // segment after the pills would then stretch its bars to fill the width
    // even though they represent smaller counts than bars in the segment
    // before it. Fix the domain to the full dataset's max so bar length stays
    // comparable across segments, same as it was before the split existed.
    const globalMax = data.length > 0 ? Math.max(...data.map(d => d.count)) : 0;
    return segments.map((seg, i) => (
      <React.Fragment key={i}>
        {seg.bars.length > 0 && (
          <div style={{ height: Math.max(30, seg.bars.length * rowHeight + 8) }}>
            <FilterBarChart data={seg.bars} xAxisMax={globalMax} {...chartProps} />
          </div>
        )}
        {seg.pillsAfter && renderPills(seg.pillsAfter)}
      </React.Fragment>
    ));
  }

  // Threats card — reassessments mode only (new-assessments shows Geospatial
  // GBIF Records instead, in Charts row 2). Lives in More Filters, not the
  // primary view — see the More Filters section below.
  const threatsCard = (() => {
    // Map label→code for reverse lookup from chart clicks
    const threatLabelToCode = new Map(THREAT_CATEGORIES.map(c => [c.label, c.code]));
    // Bar label: count + share of all in-view species (see threatTotal).
    const threatBarLabel = (count: number) =>
      `${count.toLocaleString()} (${threatTotal > 0 ? Math.round((count / threatTotal) * 100) : 0}%)`;
    // Use label as `code` field so it displays on y-axis, sorted by count desc
    const threatBarData: DrilldownBarDatum[] = THREAT_CATEGORIES
      .map(({ code, label }) => ({ code: label, rawCode: code, count: threatCounts[code] ?? 0, label: threatBarLabel(threatCounts[code] ?? 0) }))
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count);
    // selectedItems needs to use labels too for dimming. A category counts as
    // "selected" for muting purposes if it's directly selected OR any of its
    // children are (so clicking a pill mutes every OTHER top-level bar, not
    // just the ones that are themselves literally selected) — otherwise this
    // set would always end up empty once only a child pill is picked, and no
    // muting would ever happen.
    const selectedThreatLabels = new Set(
      THREAT_CATEGORIES.filter(c =>
        Array.from(selectedThreats).some(sel => sel === c.code || sel.startsWith(c.code + "."))
      ).map(c => c.label)
    );
    const loading = speciesLoading && assessedSpecies.length === 0;
    // Pills' left edge lines up with where the bars themselves start (past the
    // y-axis label column), not the chart's left edge — yAxisWidth (155) +
    // FilterBarChart's default leftMargin (5).
    const renderThreatPills = (rawCode: string) => {
      const drillCat = THREAT_CATEGORIES.find(c => c.code === rawCode);
      if (!drillCat) return null;
      return (
        <div className="flex flex-wrap gap-1 pb-1" style={{ paddingLeft: 160 }}>
          {drillCat.children.map(child => {
            const count = threatCounts[child.code] ?? 0;
            if (count === 0) return null;
            const isSelected = selectedThreats.has(child.code);
            return (
              <button
                key={child.code}
                onClick={(e) => {
                  const isMulti = e.metaKey || e.ctrlKey;
                  setSelectedThreats(prev => {
                    if (isMulti) { const next = new Set(prev); if (next.has(child.code)) next.delete(child.code); else next.add(child.code); return next; }
                    if (prev.size === 1 && prev.has(child.code)) return new Set();
                    return new Set([child.code]);
                  });
                }}
                className={`px-1.5 py-0.5 text-[11px] rounded-full transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-violet-500 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                {child.label} ({count.toLocaleString()})
              </button>
            );
          })}
        </div>
      );
    };
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
        <div className="flex items-center justify-between mb-1 min-h-[24px]">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Threats</span>
        </div>
        {loading ? (
          <div style={{ height: 200 }} className="flex items-center justify-center"><Spinner /></div>
        ) : threatBarData.length > 0 ? (
          renderInlineDrilldown(
            threatBarData,
            (rawCode) => expandedThreat.has(rawCode),
            renderThreatPills,
            {
              dataKey: "code",
              selectedItems: selectedThreatLabels,
              onBarClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
                const label = data.payload?.code;
                const code = label ? threatLabelToCode.get(label) : undefined;
                if (!code) return;
                const isMulti = event.metaKey || event.ctrlKey;
                setSelectedThreats(prev => {
                  if (isMulti) { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; }
                  if (prev.size === 1 && prev.has(code)) return new Set();
                  return new Set([code]);
                });
                setExpandedThreat(prev => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
              },
              barColor: "#8b5cf6",
              yAxisWidth: 155,
              rightMargin: 80,
              yAxisTickMaxLength: 22,
            }
          )
        ) : (
          <div style={{ height: 200 }} className="flex items-center justify-center"><span className="text-sm text-zinc-400 dark:text-zinc-500">No threat data</span></div>
        )}
      </div>
    );
  })();

  // Habitat card — same bar-chart + 2-level drill-down pattern as threatsCard
  // above (18 top-level categories is a similar scale to threats' 12, so a bar
  // chart with counts reads better here than Criteria's small pill set). Three
  // toggle buttons in the header (mirroring Conservation Status's "Threatened"
  // button) cover the issue's "specialists"/"major vs minor"/"resident vs"
  // asks — kept as simple independent booleans rather than a second Set-based
  // multi-select dimension, since each is a binary refinement, not a category.
  const habitatCard = (() => {
    const habitatLabelToCode = new Map(HABITAT_CATEGORIES.map(c => [c.label, c.code]));
    const habitatBarData: DrilldownBarDatum[] = HABITAT_CATEGORIES
      .map(({ code, label }) => ({ code: label, rawCode: code, count: habitatCounts[code] ?? 0, label: (habitatCounts[code] ?? 0).toLocaleString() }))
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count);
    const habitatTotalPages = Math.max(1, Math.ceil(habitatBarData.length / HABITAT_PAGE_SIZE));
    const safeHabitatPage = Math.min(habitatPage, habitatTotalPages - 1);
    const pagedHabitatBarData = habitatBarData.slice(safeHabitatPage * HABITAT_PAGE_SIZE, (safeHabitatPage + 1) * HABITAT_PAGE_SIZE);
    const selectedHabitatLabels = new Set(
      HABITAT_CATEGORIES.filter(c =>
        Array.from(selectedHabitat).some(sel => sel === c.code || sel.startsWith(c.code + "."))
      ).map(c => c.label)
    );
    const loading = speciesLoading && assessedSpecies.length === 0;
    const renderHabitatPills = (rawCode: string) => {
      const drillCat = HABITAT_CATEGORIES.find(c => c.code === rawCode);
      if (!drillCat) return null;
      return (
        <div className="flex flex-wrap gap-1 pb-1" style={{ paddingLeft: 160 }}>
          {drillCat.children.map(child => {
            const count = habitatCounts[child.code] ?? 0;
            if (count === 0) return null;
            const isSelected = selectedHabitat.has(child.code);
            return (
              <button
                key={child.code}
                onClick={(e) => {
                  const isMulti = e.metaKey || e.ctrlKey;
                  setSelectedHabitat(prev => {
                    if (isMulti) { const next = new Set(prev); if (next.has(child.code)) next.delete(child.code); else next.add(child.code); return next; }
                    if (prev.size === 1 && prev.has(child.code)) return new Set();
                    return new Set([child.code]);
                  });
                }}
                className={`px-1.5 py-0.5 text-[11px] rounded-full transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-teal-500 text-white"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                {child.label} ({count.toLocaleString()})
              </button>
            );
          })}
        </div>
      );
    };
    const toggleClass = (active: boolean) => `px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
      active ? "bg-teal-600 text-white shadow-sm" : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
    }`;
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
        <div className="flex items-center justify-between mb-1 min-h-[24px] flex-wrap gap-1">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Habitat</span>
          <div className="flex items-center flex-wrap gap-1 justify-end">
            {/* Breadth — single-select Specialist/Generalist dropdown, replacing
                a plain "Specialists" toggle so the (exactly 1)/(2+) split is
                explicit rather than only having an on/off specialists switch. */}
            <div className="relative" ref={habitatBreadthMenuRef}>
              <button
                type="button"
                onClick={() => { setHabitatBreadthMenuOpen(prev => !prev); setHabitatImportanceMenuOpen(false); setHabitatSeasonMenuOpen(false); setHabitatSuitabilityMenuOpen(false); }}
                className={toggleClass(habitatBreadth !== null)}
                aria-expanded={habitatBreadthMenuOpen}
              >
                {habitatBreadth === "specialist" ? "Specialists" : habitatBreadth === "generalist" ? "Generalists" : "Breadth"} ▾
              </button>
              {habitatBreadthMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 w-60">
                  {([
                    { value: null, label: "All species", hint: null },
                    { value: "specialist" as const, label: "Specialists", hint: "Exactly one known top-level habitat category" },
                    { value: "generalist" as const, label: "Generalists", hint: "Two or more known top-level habitat categories" },
                  ]).map(({ value, label, hint }) => (
                    <label
                      key={label}
                      className="flex items-start gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="habitat-breadth"
                        checked={habitatBreadth === value}
                        onChange={() => setHabitatBreadth(value)}
                        className="mt-0.5 border-zinc-300 dark:border-zinc-600 text-teal-600 focus:ring-teal-500"
                      />
                      <span>
                        {label}
                        {hint && (
                          <>
                            <br />
                            <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{hint}</span>
                          </>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Importance — multi-select checkbox list, all checked by default
                (nothing excluded); unchecking e.g. "Minor" behaves like the old
                "Exclude minor" toggle but reads less ambiguously as one option
                among an explicit, fully-visible set (matching Season below). */}
            <div className="relative" ref={habitatImportanceMenuRef}>
              <button
                type="button"
                onClick={() => { setHabitatImportanceMenuOpen(prev => !prev); setHabitatBreadthMenuOpen(false); setHabitatSeasonMenuOpen(false); setHabitatSuitabilityMenuOpen(false); }}
                className={toggleClass(habitatImportanceActive)}
                aria-expanded={habitatImportanceMenuOpen}
              >
                Importance{habitatImportanceActive ? ` (${selectedHabitatImportance.size})` : ""} ▾
              </button>
              {habitatImportanceMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 w-48">
                  {HABITAT_IMPORTANCE_OPTIONS.map(({ value, short }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
                      title={value === "Unknown" ? "Importance not recorded in the IUCN DB" : value}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHabitatImportance.has(value)}
                        onChange={() => setSelectedHabitatImportance(prev => {
                          const next = new Set(prev);
                          if (next.has(value)) next.delete(value); else next.add(value);
                          return next;
                        })}
                        className="rounded border-zinc-300 dark:border-zinc-600 text-teal-600 focus:ring-teal-500"
                      />
                      {short}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Season — multi-select checkbox list in a dropdown, all checked by
                default (nothing excluded), covering all 5 IUCN season values. */}
            <div className="relative" ref={habitatSeasonMenuRef}>
              <button
                type="button"
                onClick={() => { setHabitatSeasonMenuOpen(prev => !prev); setHabitatBreadthMenuOpen(false); setHabitatImportanceMenuOpen(false); setHabitatSuitabilityMenuOpen(false); }}
                className={toggleClass(habitatSeasonsActive)}
                aria-expanded={habitatSeasonMenuOpen}
              >
                Season{habitatSeasonsActive ? ` (${selectedHabitatSeasons.size})` : ""} ▾
              </button>
              {habitatSeasonMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 w-48">
                  {HABITAT_SEASON_OPTIONS.map(({ value, short }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
                      title={value}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHabitatSeasons.has(value)}
                        onChange={() => setSelectedHabitatSeasons(prev => {
                          const next = new Set(prev);
                          if (next.has(value)) next.delete(value); else next.add(value);
                          return next;
                        })}
                        className="rounded border-zinc-300 dark:border-zinc-600 text-teal-600 focus:ring-teal-500"
                      />
                      {short}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Suitability — multi-select checkbox list, all checked by default
                (nothing excluded), covering all 3 IUCN suitability values. */}
            <div className="relative" ref={habitatSuitabilityMenuRef}>
              <button
                type="button"
                onClick={() => { setHabitatSuitabilityMenuOpen(prev => !prev); setHabitatBreadthMenuOpen(false); setHabitatImportanceMenuOpen(false); setHabitatSeasonMenuOpen(false); }}
                className={toggleClass(habitatSuitabilityActive)}
                aria-expanded={habitatSuitabilityMenuOpen}
              >
                Suitability{habitatSuitabilityActive ? ` (${selectedHabitatSuitability.size})` : ""} ▾
              </button>
              {habitatSuitabilityMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1 w-48">
                  {HABITAT_SUITABILITY_OPTIONS.map(({ value, short }) => (
                    <label
                      key={value}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-700/50 cursor-pointer"
                      title={value === "Unknown" ? "Suitability not recorded in the IUCN DB" : value}
                    >
                      <input
                        type="checkbox"
                        checked={selectedHabitatSuitability.has(value)}
                        onChange={() => setSelectedHabitatSuitability(prev => {
                          const next = new Set(prev);
                          if (next.has(value)) next.delete(value); else next.add(value);
                          return next;
                        })}
                        className="rounded border-zinc-300 dark:border-zinc-600 text-teal-600 focus:ring-teal-500"
                      />
                      {short}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        {loading ? (
          <div style={{ height: 200 }} className="flex items-center justify-center"><Spinner /></div>
        ) : habitatBarData.length > 0 ? (
          <>
            {renderInlineDrilldown(
              pagedHabitatBarData,
              (rawCode) => expandedHabitat.has(rawCode),
              renderHabitatPills,
              {
                dataKey: "code",
                selectedItems: selectedHabitatLabels,
                onBarClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
                  const label = data.payload?.code;
                  const code = label ? habitatLabelToCode.get(label) : undefined;
                  if (!code) return;
                  const isMulti = event.metaKey || event.ctrlKey;
                  setSelectedHabitat(prev => {
                    if (isMulti) { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; }
                    if (prev.size === 1 && prev.has(code)) return new Set();
                    return new Set([code]);
                  });
                  setExpandedHabitat(prev => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
                },
                barColor: "#0d9488",
                yAxisWidth: 155,
                rightMargin: 80,
                yAxisTickMaxLength: 22,
              }
            )}
            {habitatTotalPages > 1 && (
              <div className="shrink-0 flex items-center justify-between pt-1 text-[10px] text-zinc-400 dark:text-zinc-500">
                <button
                  onClick={() => setHabitatPage(p => Math.max(0, p - 1))}
                  disabled={safeHabitatPage === 0}
                  className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Prev
                </button>
                <span className="tabular-nums">Page {safeHabitatPage + 1} of {habitatTotalPages}</span>
                <button
                  onClick={() => setHabitatPage(p => Math.min(habitatTotalPages - 1, p + 1))}
                  disabled={safeHabitatPage >= habitatTotalPages - 1}
                  className="px-1.5 py-0.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next
                </button>
              </div>
            )}
          </>
        ) : (
          <div style={{ height: 200 }} className="flex items-center justify-center"><span className="text-sm text-zinc-400 dark:text-zinc-500">No habitat data</span></div>
        )}
      </div>
    );
  })();

  // Renders one small pill row for a level of the Criteria drill-down (number,
  // sub-clause, or roman-numeral rows as the user drills deeper below the
  // top-level A-E bar chart — see CRITERIA_CATEGORIES' doc comment for why the
  // depth varies per branch). Indents a little more per level so a deep drill
  // (B -> B1 -> B1b -> B1b(iii)) still reads as a staircase, not a flat list.
  // A plain click replaces the whole selection with just this code (or clears
  // it, if it was already the sole selection) — the same single-select
  // convention every other filter chip in this file uses. Cmd/ctrl-click
  // instead TOGGLES this code in/out of selectedCriteria without touching the
  // rest, for real multi-select across branches (e.g. B1b(iii) AND C2a(i)
  // together). Independently, clicking a node with children toggles ITS OWN
  // membership in expandedCriteria (not a single shared "last expanded"
  // value), so drilling into one branch never collapses another branch you
  // already had open.
  const renderCriteriaRow = (nodes: CriteriaNode[], depth: number) => (
    // Depth 1's pills align with where the bar chart's bars start
    // (yAxisWidth 42 + leftMargin 5 = 47), same principle as Threats/Habitat's
    // top-level pills; deeper levels keep the original 10px-per-level
    // staircase on top of that base.
    <div className="flex flex-wrap gap-1" style={{ paddingLeft: 47 + (depth - 1) * 10 }}>
      {nodes.map(node => {
        const isSelected = selectedCriteria.has(node.code);
        const count = criteriaCounts[node.code] ?? 0;
        if (count === 0 && !isSelected) return null;
        return (
          <button
            key={node.code}
            onClick={(e) => {
              const isMulti = e.metaKey || e.ctrlKey;
              if (isMulti) {
                setSelectedCriteria(prev => { const next = new Set(prev); if (next.has(node.code)) next.delete(node.code); else next.add(node.code); return next; });
              } else {
                setSelectedCriteria(prev => (prev.size === 1 && prev.has(node.code)) ? new Set() : new Set([node.code]));
              }
              if (node.children.length > 0) {
                setExpandedCriteria(prev => { const next = new Set(prev); if (next.has(node.code)) next.delete(node.code); else next.add(node.code); return next; });
              }
            }}
            className={`px-1.5 py-0.5 text-[11px] rounded-full transition-colors cursor-pointer ${
              isSelected
                ? "bg-indigo-500 text-white"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            }`}
            title={node.label}
          >
            {node.code} ({count.toLocaleString()})
          </button>
        );
      })}
    </div>
  );

  // Recursively renders a level and, for every node in it that's currently expanded,
  // that node's children level right after — so any number of branches (at any depth)
  // can be open simultaneously, not just one linear drill path.
  const renderCriteriaLevel = (nodes: CriteriaNode[], depth: number): React.ReactNode => (
    <React.Fragment>
      {renderCriteriaRow(nodes, depth)}
      {nodes.map(node => (
        expandedCriteria.has(node.code) && node.children.length > 0 ? (
          <React.Fragment key={`${node.code}-children`}>{renderCriteriaLevel(node.children, depth + 1)}</React.Fragment>
        ) : null
      ))}
    </React.Fragment>
  );

  // Criteria card (#436): top-level A-E as a bar chart, same interaction as
  // Threats/Habitat's top-level chart — a bar click both selects the code and
  // toggles that branch's membership in expandedCriteria. Deliberately NOT
  // sorted by count (unlike Threats/Habitat) — A-E is a standardized, widely
  // recognized IUCN ordering, and reshuffling it by count would work against
  // that familiarity. Deeper levels stay exactly as before: renderCriteriaLevel's
  // recursive pill rows, unchanged — the issue's "opens pills not nested bars"
  // ask was already true for Criteria beyond the top level.
  const criteriaCard = (() => {
    // code === rawCode here (CRITERIA_CATEGORIES' top-level code is already
    // the bare letter) — bare letters on the axis match Number of
    // Assessments' bare short labels so the two charts' bar geometry lines up
    // when they sit side by side; the full description moves to the tooltip
    // via labelFormatter below instead of living on the axis.
    const criteriaBarData: DrilldownBarDatum[] = CRITERIA_CATEGORIES
      .map(({ code }) => ({ code, rawCode: code, count: criteriaCounts[code] ?? 0, label: (criteriaCounts[code] ?? 0).toLocaleString() }))
      .filter(d => d.count > 0 || selectedCriteria.has(d.rawCode));
    // A top-level letter counts as "selected" (and so isn't muted) if it OR
    // any of its selected descendants (e.g. "B1b" under "B") is selected.
    const selectedCriteriaCodes = new Set(
      CRITERIA_CATEGORIES.filter(c =>
        Array.from(selectedCriteria).some(sel => sel === c.code || sel.startsWith(c.code))
      ).map(c => c.code)
    );
    const loading = speciesLoading && assessedSpecies.length === 0;
    const renderCriteriaPills = (rawCode: string) => {
      const node = CRITERIA_CATEGORIES.find(n => n.code === rawCode);
      if (!node) return null;
      return <div className="pb-1">{renderCriteriaLevel(node.children, 1)}</div>;
    };
    return (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
        <div className="flex items-center justify-between mb-1 min-h-[24px]">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Assessment Criteria</span>
        </div>
        {loading ? (
          <div style={{ height: 90 }} className="flex items-center justify-center"><Spinner className="h-4 w-4" /></div>
        ) : criteriaBarData.length > 0 ? (
          renderInlineDrilldown(
            criteriaBarData,
            (rawCode) => expandedCriteria.has(rawCode),
            renderCriteriaPills,
            {
              dataKey: "code",
              selectedItems: selectedCriteriaCodes,
              onBarClick: (data: { payload?: { code?: string } }, event: React.MouseEvent) => {
                const code = data.payload?.code;
                if (!code) return;
                const isMulti = event.metaKey || event.ctrlKey;
                if (isMulti) {
                  setSelectedCriteria(prev => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
                } else {
                  setSelectedCriteria(prev => (prev.size === 1 && prev.has(code)) ? new Set() : new Set([code]));
                }
                const node = CRITERIA_CATEGORIES.find(n => n.code === code);
                if (node && node.children.length > 0) {
                  setExpandedCriteria(prev => { const next = new Set(prev); if (next.has(code)) next.delete(code); else next.add(code); return next; });
                }
              },
              barColor: "#6366f1",
              yAxisWidth: 42,
              rightMargin: 85,
              labelFormatter: (code: string) => CRITERIA_CATEGORIES.find(c => c.code === code)?.label ?? code,
            },
            32
          )
        ) : (
          <div style={{ height: 90 }} className="flex items-center justify-center"><span className="text-sm text-zinc-400 dark:text-zinc-500">No criteria data</span></div>
        )}
      </div>
    );
  })();

  return (
    <div className="space-y-1 min-w-0 flex-1 flex flex-col min-h-0">
      {/* Always show Taxa Summary table */}
      <div ref={taxaSummaryScrollRef}>
      <TaxaSummary
        onToggleTaxon={handleToggleTaxon}
        selectedTaxa={selectedTaxa}
        selectedSubgroups={selectedSubgroups}
        disableAllSpecies={isNewAssessments}
        viewMode={viewMode}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        countryModeContent={countryModeContent}
        countryPillsContent={countryPillsContent}
        countryScope={countryScope}
        onToggleSubgroup={(sgId) => {
          // Clicking a view root ancestor → clear subgroups to show its children.
          // If the currently-selected subgroup is an SSC group, we got here by
          // drilling out of SSC groups mode — return to that flat table instead
          // of falling through to the plain taxon tree view.
          if (selectedTaxa.has(sgId)) {
            if ([...selectedSubgroups].some(id => id.startsWith("ssc-"))) {
              returnToLayoutMode("ssc");
              return;
            }
            setSelectedSubgroups(new Set());
            return;
          }
          const wasSelected = selectedSubgroups.has(sgId);
          if (wasSelected) {
            // Already selected — no-op (TaxaSummary handles expand/collapse,
            // ancestors handle navigation)
            return;
          } else {
            // Selecting: set exactly this one subgroup
            setSelectedSubgroups(new Set([sgId]));
            // Ensure the correct view root is selected for species fetching
            const viewRoot = getViewRootForNode(sgId);
            if (viewRoot && (!selectedTaxa.has(viewRoot) || selectedTaxa.size !== 1)) {
              skipClearOnTaxaChangeRef.current = true;
              setSelectedTaxa(new Set([viewRoot]));
            }
          }
        }}
        onNavigateToSubgroup={(taxonId, subgroupId) => {
          // Navigate directly to a taxon + subgroup atomically (avoids clearAllFilters race,
          // and pushes a single history entry so one back-press undoes the whole navigation —
          // including exiting Table 1a/SSC groups mode, which this also clears)
          skipClearOnTaxaChangeRef.current = true;
          navigateToTaxonSubgroup(taxonId, subgroupId);
        }}
      />
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 px-6 py-4 rounded-lg">
          <p className="font-medium">Failed to load {isNewAssessments ? "" : "Red List "}data</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      )}

      {/* Charts, search, and species table - only visible after a taxon is selected.
          Hidden in country mode too: TaxaSummary's own countryModeContent (the
          promoted WorldMap) is the entire page there, and selectedTaxa is only
          "all" in that mode as a side effect of loading species for the map's own
          stats (see setLayoutMode), not a real drill-down into All Species. */}
      {selectedTaxa.size > 0 && layoutMode !== "country" && (
      neTooLarge ? (
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-amber-200 dark:border-amber-900/40 px-6 py-10 text-center">
          <p className="text-base font-medium text-zinc-700 dark:text-zinc-200">
            {neTooLarge.names.join(" & ")} has {neTooLarge.neTotal.toLocaleString()} not-evaluated species — too many to load at once.
          </p>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">
            Open a sub-group (a class or order — e.g. Beetles, Crustaceans) above to view its charts and species list.
          </p>
        </div>
      ) : (
      <div className="space-y-3">

          {/* Single species header — skeleton while loading */}
          {!isSingleSpecies && urlSpecies != null && speciesLoading && (
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-4 animate-pulse">
              <div className="w-24 h-24 bg-zinc-200 dark:bg-zinc-700 rounded flex-shrink-0" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-5 bg-zinc-200 dark:bg-zinc-700 rounded w-48" />
                <div className="h-4 bg-zinc-200 dark:bg-zinc-700 rounded w-32" />
              </div>
            </div>
          )}
          {/* Single species header */}
          {isSingleSpecies && singleSpecies && (() => {
            const details = speciesDetails[singleSpecies.id];
            return (
              <div
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl px-5 py-4 flex items-center gap-4"
              >
                {details?.inatDefaultImage === undefined ? (
                  <div className="w-24 h-24 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0 flex items-center justify-center">
                    <span className="inline-block animate-spin h-5 w-5 border-2 border-zinc-400 border-t-transparent rounded-full" />
                  </div>
                ) : details?.inatDefaultImage?.squareUrl ? (
                  <img
                    src={details.inatDefaultImage.mediumUrl || details.inatDefaultImage.squareUrl}
                    alt=""
                    className="w-24 h-24 object-cover rounded flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-red-400"
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const preview = document.getElementById('image-preview');
                      if (preview) {
                        (preview as HTMLImageElement).src = details.inatDefaultImage?.mediumUrl || details.inatDefaultImage?.squareUrl || '';
                        preview.style.display = 'block';
                        preview.style.top = `${rect.top - 192 - 8}px`;
                        preview.style.left = `${rect.left}px`;
                      }
                    }}
                    onMouseLeave={() => {
                      const preview = document.getElementById('image-preview');
                      if (preview) preview.style.display = 'none';
                    }}
                  />
                ) : (
                  <div className="w-24 h-24 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 flex-shrink-0">
                    <TaxaIcon taxonId={singleSpecies.taxon_id || "all"} size={40} />
                  </div>
                )}
                <div className="min-w-0">
                  <div className="italic font-semibold text-zinc-900 dark:text-zinc-100 text-lg">
                    {singleSpecies.scientific_name}
                  </div>
                  {singleSpecies.common_name && (
                    <div className="text-zinc-500 dark:text-zinc-400 text-sm">
                      {singleSpecies.common_name}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* Charts row 1: bar charts (new-assessments mode only shows GBIF Observations) */}
          {!isNewAssessments && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Conservation Status */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Conservation Status</span>
                {!(isSingleSpecies && singleSpecies) && (
                  <button
                    type="button"
                    onClick={handleThreatenedClick}
                    className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                      isThreatenedSelected
                        ? "bg-red-600 text-white shadow-sm"
                        : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                    }`}
                    aria-pressed={isThreatenedSelected}
                    title="Select Critically Endangered, Endangered and Vulnerable"
                  >
                    Threatened
                  </button>
                )}
              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : isSingleSpecies && singleSpecies ? (
                  <span
                    className="px-5 py-2.5 text-2xl font-bold rounded text-center"
                    style={{
                      backgroundColor: (CATEGORY_COLORS[singleSpecies.category] || "#999") + "20",
                      color: singleSpecies.category === "EX" || singleSpecies.category === "EW" ? "#fff" : CATEGORY_COLORS[singleSpecies.category] || "#999",
                      ...(singleSpecies.category === "EX" || singleSpecies.category === "EW" ? { backgroundColor: CATEGORY_COLORS[singleSpecies.category] } : {}),
                    }}
                  >
                    {{ EX: "Extinct", EW: "Extinct in the Wild", CR: "Critically Endangered", EN: "Endangered", VU: "Vulnerable", NT: "Near Threatened", LC: "Least Concern", DD: "Data Deficient", NE: "Not Evaluated" }[singleSpecies.category] || singleSpecies.category}
                  </span>
                ) : categoryDataWithPercent.length > 0 ? (
                  <FilterBarChart
                    data={categoryDataWithPercent}
                    dataKey="code"
                    selectedItems={selectedCategories}
                    onBarClick={handleCategoryClick}
                    yAxisWidth={26}
                    rightMargin={55}
                    labelFormatter={(code) => ({
                      EX: "Extinct",
                      EW: "Extinct in the Wild",
                      CR: "Critically Endangered",
                      EN: "Endangered",
                      VU: "Vulnerable",
                      NT: "Near Threatened",
                      LC: "Least Concern",
                      DD: "Data Deficient",
                    }[code] || code)}
                  />
                ) : null}
              </div>
            </div>

            {/* Years Since Assessed / Year of Latest Assessment */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex flex-wrap items-center justify-between mb-1 gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
                  {yearsChartMode === "range" ? "Years Since Assessed" : "Year of Latest Assessment"}
                </span>
                <div className="flex items-center gap-2">
                  {/* Outdated shortcut: filter to species assessed >10 years ago (mirrors the Threatened button).
                      Range-view only — the Year view's muting is only year-granular, so the button's precise
                      cutoff date doesn't line up as cleanly there. */}
                  {!(isSingleSpecies && singleSpecies) && yearsChartMode === "range" && (
                    <button
                      type="button"
                      onClick={handleOutdatedClick}
                      className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                        isOutdatedSelected
                          ? "bg-red-600 text-white shadow-sm"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                      }`}
                      aria-pressed={isOutdatedSelected}
                      title={`Filter to species last assessed before ${outdatedCutoffDate(dataAsOf).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`}
                    >
                      Outdated
                    </button>
                  )}
                  {/* Pagination controls (year view only, and only when multiple pages) */}
                  {!(isSingleSpecies && singleSpecies) && yearsChartMode === "year" && yearsTotalPages > 1 && (() => {
                    const firstYear = paginatedAssessmentYearsData[0]?.code;
                    const lastYear = paginatedAssessmentYearsData[paginatedAssessmentYearsData.length - 1]?.code;
                    const label = firstYear && lastYear
                      ? (firstYear === lastYear ? firstYear : `${firstYear}–${lastYear}`)
                      : "";
                    const canPrev = yearsPage > 0;
                    const canNext = yearsPage < yearsTotalPages - 1;
                    return (
                      <div className="inline-flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <button
                          type="button"
                          onClick={() => canPrev && setYearsPage(p => Math.max(0, p - 1))}
                          disabled={!canPrev}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Previous years"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                          </svg>
                        </button>
                        <span className="tabular-nums min-w-[64px] text-center" aria-live="polite" aria-atomic="true">{label}</span>
                        <button
                          type="button"
                          onClick={() => canNext && setYearsPage(p => Math.min(yearsTotalPages - 1, p + 1))}
                          disabled={!canNext}
                          className="w-5 h-5 flex items-center justify-center rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
                          aria-label="Next years"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        </button>
                      </div>
                    );
                  })()}
                  {!(isSingleSpecies && singleSpecies) && (
                    <select
                      value={yearsChartMode}
                      onChange={(e) => setYearsChartMode(e.target.value as "range" | "year")}
                      aria-label="Year chart view"
                      className="text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-md px-1.5 py-0.5 text-zinc-700 dark:text-zinc-300 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
                    >
                      <option value="range">Range</option>
                      <option value="year">Year</option>
                    </select>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-[150px] flex flex-col">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center"><Spinner /></div>
                ) : isSingleSpecies && singleSpecies ? (
                  <div className="flex-1 flex items-center justify-center">
                    {(() => {
                      if (!singleSpecies.assessment_date) return (
                        <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">N/A</span>
                      );
                      const msPerYear = 365.25 * 24 * 60 * 60 * 1000;
                      const elapsed = Date.now() - new Date(singleSpecies.assessment_date).getTime();
                      const yearsSince = elapsed / msPerYear;
                      const range = yearsSince < 1 ? "<1y" : yearsSince < 5 ? "1-5y" : yearsSince < 10 ? "5-10y" : yearsSince < 20 ? "10-20y" : ">20y";
                      return (
                        <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                          {range}
                        </span>
                      );
                    })()}
                  </div>
                ) : yearsChartMode === "range" ? (
                  assessmentYearData.length > 0 ? (
                    <div className="flex-1 flex items-center justify-center">
                      <FilterBarChart
                        data={assessmentYearData}
                        dataKey="shortRange"
                        selectedItems={yearRangeSelectedItems}
                        onBarClick={handleYearClick}
                        barColor="#3b82f6"
                        yAxisWidth={36}
                        rightMargin={85}
                      />
                    </div>
                  ) : null
                ) : paginatedAssessmentYearsData.length > 0 ? (
                  <div className="flex-1">
                    <YearBarChart
                      data={paginatedAssessmentYearsData}
                      selectedItems={assessmentYearSelectedItems}
                      onBarClick={handleAssessmentYearClick}
                      barColor="#3b82f6"
                      yMax={yearsGlobalMax}
                    />
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <span className="text-sm text-zinc-400 dark:text-zinc-500">No assessments</span>
                  </div>
                )}
              </div>
            </div>

            {/* GBIF Records */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">GBIF Records <GbifInfoTooltip /></span>
                              </div>
              <div className="flex-1 min-h-[150px] flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : isSingleSpecies && singleSpecies ? (() => {
                  const obs = singleSpecies.gbif_occurrence_count ?? 0;
                  const range = obs === 0 ? "0" : obs <= 10 ? "1-10" : obs <= 100 ? "11-100" : obs <= 1000 ? "101-1K" : obs <= 10000 ? "1K-10K" : "10K+";
                  return (
                    <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                      {range}
                    </span>
                  );
                })() : gbifObsData.length > 0 ? (
                  <FilterBarChart
                    data={gbifObsData}
                    dataKey="shortRange"
                    selectedItems={selectedObsRanges}
                    onBarClick={handleObsClick}
                    barColor="#10b981"
                    yAxisWidth={42}
                    rightMargin={85}
                  />
                ) : null}
              </div>
            </div>
          </div>
          )}

          {/* Charts row 2 (new-assessments mode only): Country map + Year
              Described + GBIF Records, 3-col, 1/3 each. For
              reassessments, Country map + Threats live in More Filters
              instead (below) — decluttered out of the always-visible primary
              view now that they're not the only geographic/threat filter
              (see countryMapCard/threatsCard, defined above). */}
          {isNewAssessments && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {countryMapCard}

            {/* Year Described */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">
                  Year Described
                  <HoverTooltip text="Year the species was scientifically described, from the Catalogue of Life. Available for ~99% of animals; many plants, fungi and algae have no datable record in CoL and fall under 'Unknown'.">
                    <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M12 16v-4M12 8h.01" />
                    </svg>
                  </HoverTooltip>
                </span>
              </div>
              <div style={{ height: 180 }} className="flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : describedYearData.length > 0 ? (
                  <FilterBarChart
                    data={describedYearData}
                    dataKey="shortRange"
                    selectedItems={selectedDescribedYears}
                    onBarClick={handleDescribedYearClick}
                    barColor="#3b82f6"
                    yAxisWidth={64}
                    rightMargin={85}
                  />
                ) : (
                  <span className="text-sm text-zinc-400 dark:text-zinc-500">No description-year data</span>
                )}
              </div>
            </div>

            {/* GBIF Records */}
            <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1">GBIF Records <GbifInfoTooltip /></span>
              </div>
              <div style={{ height: 180 }} className="flex items-center justify-center">
                {speciesLoading && assessedSpecies.length === 0 ? (
                  <Spinner />
                ) : (
                  <FilterBarChart
                    data={gbifObsData}
                    dataKey="shortRange"
                    selectedItems={selectedObsRanges}
                    onBarClick={handleObsClick}
                    barColor="#10b981"
                    yAxisWidth={42}
                    rightMargin={85}
                  />
                )}
              </div>
            </div>
          </div>
          )}

          {/* Country + Threats are always visible, alongside Charts row 1
              above — everything past that (Growth Form, Assessment
              Criteria/Number of Assessments, Realm/Movement/Trend,
              Habitat/Assessors-Reviewers) lives behind the "More Filters"
              toggle below. No independently-scrollable panel here anymore
              — nested scrollbars (the panel's own, inside the page's) read as
              confusing, so this reverts to plain click-to-expand instead. */}
          {!isNewAssessments && (
            <>
                {/* Country, Threats — paired side by side. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {countryMapCard}
                  {threatsCard}
                </div>

                <button
                  onClick={() => setMoreFiltersOpen(prev => !prev)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
                >
                  <svg className={`w-3.5 h-3.5 transition-transform ${moreFiltersOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  More Filters
                  {(selectedGrowthForms.size + selectedHabitat.size + (habitatBreadth ? 1 : 0) + (habitatImportanceActive ? 1 : 0) + (habitatSeasonsActive ? 1 : 0) + (habitatSuitabilityActive ? 1 : 0) + selectedAssessmentCounts.size + selectedSystems.size + selectedMovementPatterns.size + selectedPopulationTrends.size + selectedCriteria.size + selectedAssessors.size + selectedReviewers.size > 0) && (
                    <span className="ml-1 px-1.5 py-0.5 text-[10px] rounded-full bg-zinc-200 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300">
                      {selectedGrowthForms.size + selectedHabitat.size + (habitatBreadth ? 1 : 0) + (habitatImportanceActive ? 1 : 0) + (habitatSeasonsActive ? 1 : 0) + (habitatSuitabilityActive ? 1 : 0) + selectedAssessmentCounts.size + selectedSystems.size + selectedMovementPatterns.size + selectedPopulationTrends.size + selectedCriteria.size + selectedAssessors.size + selectedReviewers.size} active
                    </span>
                  )}
                </button>
            </>
          )}

          {!isNewAssessments && moreFiltersOpen && (
            <>
                {/* Growth Form (plants/fungi only) */}
                {(() => {
                  if (speciesLoading && assessedSpecies.length === 0) {
                    return (
                      <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Growth</span>
                        <Spinner className="h-4 w-4" />
                      </div>
                    );
                  }
                  // Compute growth form counts cross-filtered (exclude own filter)
                  const gfCounts: Record<string, number> = {};
                  taxaFilteredSpecies.forEach(s => {
                    if (!s.growth_forms?.length) return;
                    if (!matchesSearch(s)) return;
                    if (selectedCategories.size > 0 && !selectedCategories.has(s.category)) return;
                    if (selectedCountries.size > 0 && !s.countries.some(c => selectedCountries.has(c))) return;
                    if (s.category !== "NE" && selectedYearRanges.size > 0 && !matchesYearRangeFilter(s.assessment_date, selectedYearRanges)) return;
                    if (s.category !== "NE" && selectedAssessmentYears.size > 0 && !matchesAssessmentYearFilter(s.assessment_date, selectedAssessmentYears)) return;
                    if (selectedObsRanges.size > 0 && !matchesObsRangeFilter(s.gbif_occurrence_count, selectedObsRanges)) return;
                    if (selectedAssessmentCounts.size > 0 && !matchesAssessmentCountFilter(s.assessment_count, selectedAssessmentCounts)) return;
                    if (selectedSystems.size > 0 && !s.systems?.some(sys => selectedSystems.has(sys))) return;
                    if (selectedPopulationTrends.size > 0 && (!s.population_trend || !selectedPopulationTrends.has(s.population_trend))) return;
                    if (selectedMovementPatterns.size > 0 && (!s.movement_pattern || !selectedMovementPatterns.has(s.movement_pattern))) return;
                    if (selectedThreats.size > 0 && !s.threat_codes?.some(tc => Array.from(selectedThreats).some(sel => tc === sel || tc.startsWith(sel + ".")))) return;
                    if (selectedCriteria.size > 0 && !parseCriteriaCodes(s.criteria).some(code => Array.from(selectedCriteria).some(sel => code === sel || code.startsWith(sel)))) return;
                    if (endemicsOnly && s.countries.length !== 1) return;
                    if (!matchesAssessorsFilter(s)) return;
                    if (!matchesHabitatFilter(s)) return;
                    if (!matchesReviewersFilter(s)) return;
                    for (const gf of s.growth_forms) {
                      gfCounts[gf] = (gfCounts[gf] || 0) + 1;
                    }
                  });
                  const sorted = Object.entries(gfCounts).sort((a, b) => b[1] - a[1]);
                  if (sorted.length === 0) return null;
                  return (
                    <div className="flex items-start gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20 pt-1">Growth</span>
                      <div className="flex flex-wrap gap-1.5">
                        {sorted.map(([gf, count]) => {
                          const isSelected = selectedGrowthForms.has(gf);
                          return (
                            <button
                              key={gf}
                              onClick={(e) => {
                                const isMulti = e.metaKey || e.ctrlKey;
                                setSelectedGrowthForms(prev => {
                                  if (isMulti) { const next = new Set(prev); if (next.has(gf)) next.delete(gf); else next.add(gf); return next; }
                                  if (prev.size === 1 && prev.has(gf)) return new Set();
                                  return new Set([gf]);
                                });
                              }}
                              className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                                isSelected
                                  ? "bg-lime-500 text-white"
                                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                              }`}
                            >
                              {gf} ({count.toLocaleString()})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Assessment Criteria alongside Number of Assessments — a row, not a
                    stack (previously stacked in Habitat's right column; moved
                    out once Habitat started pairing with Assessors/Reviewers
                    instead). */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {/* Criteria — top-level A-E bar chart (see criteriaCard);
                      clicking a bar both selects it as a filter AND expands
                      its next level below (number -> sub-clause -> roman
                      numeral, as deep as that branch goes) as pill rows via
                      renderCriteriaLevel, since criteria nests up to 4
                      levels vs. Threats/Habitat's 2. Cmd/ctrl-click for real
                      multi-select — any number of branches can be drilled
                      into and selected simultaneously (e.g. B1b(iii) AND
                      C2a(i) together), each independently expanded via
                      expandedCriteria (a Set, not a single "last expanded"
                      value). A species can satisfy multiple codes under the
                      same letter too (e.g. B1+B2, or B1a and B1b together),
                      so selecting any code matches species with that code
                      OR a more specific one beneath it (see
                      parseCriteriaCodes' startsWith-based matching). */}
                  {!isNewAssessments && criteriaCard}

                  {/* Number of Assessments (#423 item 1) — how many times a
                      species has been assessed, with a "Reassessed" shortcut
                      selecting every bucket >= 2 in one click (1+ reassessment
                      = 2+ total assessments, per the issue's explicit ask),
                      same shape as the Outdated shortcut next to Years Since
                      Assessed. */}
                  {!isNewAssessments && (
                    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Number of Assessments</span>
                        <button
                          type="button"
                          onClick={handleReassessedClick}
                          className={`px-2 py-0.5 text-xs font-semibold rounded transition-colors ${
                            isReassessedSelected
                              ? "bg-red-600 text-white shadow-sm"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"
                          }`}
                          aria-pressed={isReassessedSelected}
                          title="Filter to species assessed 2 or more times (reassessed at least once)"
                        >
                          Reassessed
                        </button>
                      </div>
                      <div style={{ height: 170 }} className="flex items-center justify-center">
                        {speciesLoading && assessedSpecies.length === 0 ? (
                          <Spinner />
                        ) : isSingleSpecies && singleSpecies ? (
                          <span className="text-4xl font-bold text-zinc-900 dark:text-zinc-100">
                            {assessmentCountBucket(singleSpecies.assessment_count)}
                          </span>
                        ) : assessmentCountData.length > 0 ? (
                          <FilterBarChart
                            data={assessmentCountData}
                            dataKey="shortRange"
                            selectedItems={selectedAssessmentCounts}
                            onBarClick={handleAssessmentCountClick}
                            barColor="#8b5cf6"
                            yAxisWidth={42}
                            rightMargin={85}
                          />
                        ) : null}
                      </div>
                    </div>
                  )}
                </div>

                {/* Realm, Movement, and Trend as three columns in one row. */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* Realm */}
                  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Realm</span>
                    <div className="flex flex-wrap gap-1.5">
                      {speciesLoading && assessedSpecies.length === 0 ? (
                        <Spinner className="h-4 w-4" />
                      ) : (["Terrestrial", "Freshwater", "Marine"] as const).map(system => {
                        const isSelected = selectedSystems.has(system);
                        const count = realmCounts[system] ?? 0;
                        return (
                          <button
                            key={system}
                            onClick={(e) => {
                              const isMulti = e.metaKey || e.ctrlKey;
                              setSelectedSystems(prev => {
                                if (isMulti) { const next = new Set(prev); if (next.has(system)) next.delete(system); else next.add(system); return next; }
                                if (prev.size === 1 && prev.has(system)) return new Set();
                                return new Set([system]);
                              });
                            }}
                            className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                              isSelected
                                ? system === "Terrestrial" ? "bg-amber-500 text-white"
                                : system === "Freshwater" ? "bg-cyan-500 text-white"
                                : "bg-blue-600 text-white"
                                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {system} ({count.toLocaleString()})
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Movement Patterns */}
                  {!isNewAssessments && (
                    <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                      <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Movement</span>
                        <div className="flex flex-wrap gap-1.5">
                          {speciesLoading && assessedSpecies.length === 0 ? (
                            <Spinner className="h-4 w-4" />
                          ) : (["Full Migrant", "Altitudinal Migrant", "Nomadic", "Not a Migrant", "Unknown"] as const).map(pattern => {
                            const isSelected = selectedMovementPatterns.has(pattern);
                            const count = movementPatternCounts[pattern] ?? 0;
                            if (count === 0) return null;
                            return (
                              <button
                                key={pattern}
                                onClick={(e) => {
                                  const isMulti = e.metaKey || e.ctrlKey;
                                  setSelectedMovementPatterns(prev => {
                                    if (isMulti) { const next = new Set(prev); if (next.has(pattern)) next.delete(pattern); else next.add(pattern); return next; }
                                    if (prev.size === 1 && prev.has(pattern)) return new Set();
                                    return new Set([pattern]);
                                  });
                                }}
                                className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                                  isSelected
                                    ? "bg-teal-500 text-white"
                                    : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                                }`}
                              >
                                {pattern} ({count.toLocaleString()})
                              </button>
                            );
                          })}
                        </div>
                    </div>
                  )}

                  {/* Trend */}
                  <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2">
                    <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 shrink-0 w-20">Trend</span>
                    <div className="flex flex-wrap gap-1.5">
                      {speciesLoading && assessedSpecies.length === 0 ? (
                        <Spinner className="h-4 w-4" />
                      ) : (["Increasing", "Stable", "Decreasing", "Unknown"] as const).map(trend => {
                        const isSelected = selectedPopulationTrends.has(trend);
                        const count = populationTrendCounts[trend] ?? 0;
                        return (
                          <button
                            key={trend}
                            onClick={(e) => {
                              const isMulti = e.metaKey || e.ctrlKey;
                              setSelectedPopulationTrends(prev => {
                                if (isMulti) { const next = new Set(prev); if (next.has(trend)) next.delete(trend); else next.add(trend); return next; }
                                if (prev.size === 1 && prev.has(trend)) return new Set();
                                return new Set([trend]);
                              });
                            }}
                            className={`px-2 py-1 text-xs rounded-full transition-colors cursor-pointer ${
                              isSelected
                                ? "bg-orange-500 text-white"
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700"
                            }`}
                          >
                            {trend === "Increasing" ? "↑" : trend === "Decreasing" ? "↓" : trend === "Stable" ? "→" : "?"} {trend} ({count.toLocaleString()})
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Habitat alongside Assessors/Reviewers. */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {habitatCard}
                  {isSingleSpecies && singleSpecies ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {([
                        { title: "Assessors", names: singleSpeciesAssessors },
                        { title: "Reviewers", names: singleSpeciesReviewers },
                      ] as const).map(({ title, names }) => (
                        <div key={title} className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-3 flex flex-col">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
                          </div>
                          <div className="overflow-y-auto mt-2" style={{ maxHeight: 260 }}>
                            {names.length > 0 ? (
                              <div className="flex flex-wrap gap-2">
                                {names.map((name) => (
                                  <span key={name} className="inline-block px-3 py-1.5 text-sm rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300">{name}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-sm text-zinc-400 dark:text-zinc-500">None listed</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <ReviewerChart
                      allAssessors={assessorChartData}
                      allReviewers={reviewerChartData}
                      viewMode={assessorReviewerMode}
                      onViewModeChange={setAssessorReviewerMode}
                      selectedItems={assessorReviewerMode === "assessors" ? selectedAssessors : selectedReviewers}
                      onBarClick={makeAssessorClick(assessorReviewerMode === "assessors" ? setSelectedAssessors : setSelectedReviewers)}
                      onItemToggle={makeAssessorToggle(assessorReviewerMode === "assessors" ? setSelectedAssessors : setSelectedReviewers)}
                      loading={speciesLoading && assessedSpecies.length === 0}
                    />
                  )}
                </div>

            </>
          )}

      {/* Species Table */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
        {/* Applied filters — every currently-active filter (including the
            selected taxon/subgroup/breakdown-name) as a removable pill,
            directly above the table they filter. Clear all resets everything
            here, taxon/subgroup included — Home is for the "go back to
            nothing selected at all" case; this is for "same taxon, different
            filters". The free-text box narrows the visible table by name in
            place, composing with the pills beside it — distinct from the page
            header's SpeciesSearchBar, which navigates elsewhere instead of
            narrowing here (see DebouncedSearchInput's own doc comment). */}
        <div className="p-3 md:p-4 border-b border-zinc-200 dark:border-zinc-800 rounded-t-xl">
          <div className="flex flex-wrap items-center gap-2 md:gap-4">
            <div className="relative flex-1 min-w-[140px] max-w-md">
              <DebouncedSearchInput
                onSearch={handleSearch}
                initialValue={searchFilter}
                className="w-full px-3 md:px-4 py-2 pl-9 md:pl-10 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
              />
              <svg
                className="absolute left-2.5 md:left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            {(selectedTaxa.size > 0 || selectedSubgroups.size > 0 || selectedCategories.size > 0 || selectedYearRanges.size > 0 || selectedAssessmentYears.size > 0 || selectedDescribedYears.size > 0 || selectedObsRanges.size > 0 || selectedAssessmentCounts.size > 0 || selectedCountries.size > 0 || selectedSystems.size > 0 || endemicsOnly || selectedGrowthForms.size > 0 || selectedPopulationTrends.size > 0 || selectedMovementPatterns.size > 0 || selectedThreats.size > 0 || selectedCriteria.size > 0 || selectedHabitat.size > 0 || habitatBreadth || habitatImportanceActive || habitatSeasonsActive || habitatSuitabilityActive || selectedAssessors.size > 0 || selectedReviewers.size > 0 || showOnlyStarred || exactFilters.outdated || exactFilters.minObs != null || exactFilters.maxObs != null || exactFilters.minAssessmentYear != null || exactFilters.maxAssessmentYear != null || exactFilters.minDescribedYear != null || exactFilters.maxDescribedYear != null) && (
              <button
                onClick={() => {
                  clearAllFiltersAndTaxa();
                  setShowOnlyStarred(false);
                  setExpandedThreat(new Set());
                  setExpandedCriteria(new Set());
                  setExpandedHabitat(new Set());
                }}
                title="Reset all filters and the selected taxon"
                className="px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700 shrink-0"
              >
                <svg className="w-3.5 h-3.5 md:w-4 md:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="hidden sm:inline">Clear all</span>
              </button>
            )}
            {pinnedSpecies.length > 0 && (
              <button
                onClick={() => setShowOnlyStarred(!showOnlyStarred)}
                className={`px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium transition-colors flex items-center gap-1 md:gap-1.5 ${
                  showOnlyStarred
                    ? "bg-amber-500 text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700"
                }`}
              >
                <svg className="w-4 h-4" fill={showOnlyStarred ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
                <span className="hidden sm:inline">Starred</span> ({pinnedSpecies.length})
              </button>
            )}
            {Array.from(selectedTaxa).map(taxonId => (
              <button
                key={taxonId}
                onClick={() => setSelectedTaxa(prev => { const next = new Set(prev); next.delete(taxonId); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: (TAXA_BY_ID[taxonId]?.color || "#666") + "20", color: TAXA_BY_ID[taxonId]?.color || "#666" }}
              >
                {TAXA_BY_ID[taxonId]?.name || taxonId}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedSubgroups).map(sgId => {
              const sgInfo = getNodeDef(sgId);
              return (
                <button
                  key={sgId}
                  onClick={() => setSelectedSubgroups(prev => { const next = new Set(prev); next.delete(sgId); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
                >
                  {sgInfo?.node.name ?? dynamicNodeDisplayName(sgId)}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {breakdownFilter && selectedSubgroups.has(breakdownFilter.nodeId) && (
              <button
                onClick={() => setBreakdownFilter(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {breakdownDisplayName(breakdownFilter.rank, breakdownFilter.name)}
                {breakdownFilter.onlyIds?.length ? " — No CoL Match" : breakdownFilter.excludeIds?.length ? " — CoL Match" : ""}
                <span className="text-sm">×</span>
              </button>
            )}
            {!isNewAssessments && Array.from(selectedCategories).map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategories(prev => { const next = new Set(prev); next.delete(cat); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80"
                style={{ backgroundColor: CATEGORY_COLORS[cat] + "20", color: CATEGORY_COLORS[cat] }}
              >
                {cat}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedYearRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedYearRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                {range}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedAssessmentYears).sort((a, b) => Number(b) - Number(a)).map(year => (
              <button
                key={`ay-${year}`}
                onClick={() => setSelectedAssessmentYears(prev => { const next = new Set(prev); next.delete(year); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400 flex items-center gap-1 hover:opacity-80"
              >
                Assessed {year}
                <span className="text-sm">×</span>
              </button>
            ))}
            {isNewAssessments && Array.from(selectedDescribedYears).map(range => (
              <button
                key={`dy-${range}`}
                onClick={() => setSelectedDescribedYears(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                Described {range}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedObsRanges).map(range => (
              <button
                key={range}
                onClick={() => setSelectedObsRanges(prev => { const next = new Set(prev); next.delete(range); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400 flex items-center gap-1 hover:opacity-80"
              >
                {range} obs
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedAssessmentCounts).map(count => (
              <button
                key={`assessment-count-${count}`}
                onClick={() => setSelectedAssessmentCounts(prev => { const next = new Set(prev); next.delete(count); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {count} {count === "1" ? "assessment" : "assessments"}
                <span className="text-sm">×</span>
              </button>
            ))}
            {(() => {
              if (selectedCountries.size === 0) return null;
              // Check if selected countries exactly match a single IUCN region
              const regions = new Set<string>();
              selectedCountries.forEach(c => regions.add(countryToIucnRegion(c)));
              if (regions.size === 1) {
                const region = [...regions][0];
                if (region !== "Other") {
                  const regionCodes = iucnRegionCountries(region);
                  if (regionCodes.length === selectedCountries.size && regionCodes.every(c => selectedCountries.has(c))) {
                    return (
                      <button
                        onClick={() => setSelectedCountries(new Set())}
                        className="px-3 py-1.5 text-sm font-medium rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-1 hover:opacity-80"
                      >
                        {region}
                        <span className="text-sm">×</span>
                      </button>
                    );
                  }
                }
              }
              // Otherwise show individual country pills
              return Array.from(selectedCountries).map(code => (
                <button
                  key={code}
                  onClick={() => setSelectedCountries(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-green-100 text-green-600 dark:bg-green-900/30 dark:text-green-400 flex items-center gap-1 hover:opacity-80"
                >
                  {getCountryName(code)}
                  <span className="text-sm">×</span>
                </button>
              ));
            })()}
            {Array.from(selectedGrowthForms).map(gf => (
              <button
                key={`gf-${gf}`}
                onClick={() => setSelectedGrowthForms(prev => { const next = new Set(prev); next.delete(gf); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-lime-100 text-lime-600 dark:bg-lime-900/30 dark:text-lime-400 flex items-center gap-1 hover:opacity-80"
              >
                {gf}
                <span className="text-sm">×</span>
              </button>
            ))}
            {endemicsOnly && (
              <button
                onClick={() => setEndemicsOnly(false)}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                Endemics only
                <span className="text-sm">×</span>
              </button>
            )}
            {Array.from(selectedPopulationTrends).map(trend => (
              <button
                key={`trend-${trend}`}
                onClick={() => setSelectedPopulationTrends(prev => { const next = new Set(prev); next.delete(trend); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-orange-100 text-orange-600 dark:bg-orange-900/30 dark:text-orange-400 flex items-center gap-1 hover:opacity-80"
              >
                {trend}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedMovementPatterns).map(pattern => (
              <button
                key={`mov-${pattern}`}
                onClick={() => setSelectedMovementPatterns(prev => { const next = new Set(prev); next.delete(pattern); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                {pattern}
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedThreats).map(code => {
              const cat = THREAT_CATEGORIES.find(c => c.code === code);
              const sub = !cat ? THREAT_CATEGORIES.flatMap(c => c.children).find(c => c.code === code) : null;
              const label = cat?.label || sub?.label || code;
              return (
                <button
                  key={`threat-${code}`}
                  onClick={() => setSelectedThreats(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-rose-100 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400 flex items-center gap-1 hover:opacity-80"
                >
                  {label}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {Array.from(selectedCriteria).map(code => {
              const label = findCriteriaNode(CRITERIA_CATEGORIES, code)?.label || code;
              return (
                <button
                  key={`criteria-${code}`}
                  onClick={() => setSelectedCriteria(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-indigo-100 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400 flex items-center gap-1 hover:opacity-80"
                >
                  {label}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {Array.from(selectedHabitat).map(code => {
              const cat = HABITAT_CATEGORIES.find(c => c.code === code);
              const sub = !cat ? HABITAT_CATEGORIES.flatMap(c => c.children).find(c => c.code === code) : null;
              const label = cat?.label || sub?.label || code;
              return (
                <button
                  key={`habitat-${code}`}
                  onClick={() => setSelectedHabitat(prev => { const next = new Set(prev); next.delete(code); return next; })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
                >
                  {label}
                  <span className="text-sm">×</span>
                </button>
              );
            })}
            {habitatBreadth && (
              <button
                onClick={() => setHabitatBreadth(null)}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                Habitat {habitatBreadth === "specialist" ? "specialists" : "generalists"}
                <span className="text-sm">×</span>
              </button>
            )}
            {/* Importance/Season both default to "everything checked". The chip
                shows what's actually SELECTED (positive framing) rather than what's
                excluded — narrowing down to one or two values (e.g. "Major",
                "Resident") is the more common case, and reads far more clearly than
                spelling out every other unchecked value ("No Minor", "No Unknown",
                "No Breeding", ...). Clicking × removes it from the selection. */}
            {habitatImportanceActive && HABITAT_IMPORTANCE_OPTIONS.filter(({ value }) => selectedHabitatImportance.has(value)).map(({ value, short }) => (
              <button
                key={`habitat-importance-${value}`}
                onClick={() => setSelectedHabitatImportance(prev => { const next = new Set(prev); next.delete(value); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                {short} habitat
                <span className="text-sm">×</span>
              </button>
            ))}
            {habitatSeasonsActive && HABITAT_SEASON_OPTIONS.filter(({ value }) => selectedHabitatSeasons.has(value)).map(({ value, short }) => (
              <button
                key={`habitat-season-${value}`}
                onClick={() => setSelectedHabitatSeasons(prev => { const next = new Set(prev); next.delete(value); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                {short}
                <span className="text-sm">×</span>
              </button>
            ))}
            {habitatSuitabilityActive && HABITAT_SUITABILITY_OPTIONS.filter(({ value }) => selectedHabitatSuitability.has(value)).map(({ value, short }) => (
              <button
                key={`habitat-suitability-${value}`}
                onClick={() => setSelectedHabitatSuitability(prev => { const next = new Set(prev); next.delete(value); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-teal-100 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400 flex items-center gap-1 hover:opacity-80"
              >
                {short} suitability
                <span className="text-sm">×</span>
              </button>
            ))}
            {Array.from(selectedSystems).map(system => (
              <button
                key={system}
                onClick={() => setSelectedSystems(prev => { const next = new Set(prev); next.delete(system); return next; })}
                className={`px-3 py-1.5 text-sm font-medium rounded-full flex items-center gap-1 hover:opacity-80 ${
                  system === "Terrestrial" ? "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                  : system === "Freshwater" ? "bg-cyan-100 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
                  : "bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                }`}
              >
                {system}
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedAssessors).map(name => (
              <button
                key={`a-${name}`}
                onClick={() => setSelectedAssessors(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-violet-100 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(assessor)</span>
                <span className="text-sm">×</span>
              </button>
            ))}
            {!isNewAssessments && Array.from(selectedReviewers).map(name => (
              <button
                key={`r-${name}`}
                onClick={() => setSelectedReviewers(prev => { const next = new Set(prev); next.delete(name); return next; })}
                className="px-3 py-1.5 text-sm font-medium rounded-full bg-fuchsia-100 text-fuchsia-600 dark:bg-fuchsia-900/30 dark:text-fuchsia-400 flex items-center gap-1 hover:opacity-80"
              >
                {name} <span className="text-[10px] opacity-60">(reviewer)</span>
                <span className="text-sm">×</span>
              </button>
            ))}
            {/* Exact URL-only filters (typically arrive via an agent/MCP dashboard
                link). Shown as chips so a human can see and clear them. */}
            {(() => {
              const ef = exactFilters;
              const chips: { key: keyof typeof ef; label: string }[] = [];
              if (ef.outdated) chips.push({ key: "outdated", label: ef.outdated === "yes" ? "Outdated (>10 yrs)" : "Current (≤10 yrs)" });
              if (ef.minObs != null) chips.push({ key: "minObs", label: `≥ ${ef.minObs.toLocaleString()} obs` });
              if (ef.maxObs != null) chips.push({ key: "maxObs", label: `≤ ${ef.maxObs.toLocaleString()} obs` });
              if (ef.minAssessmentYear != null) chips.push({ key: "minAssessmentYear", label: `Assessed ≥ ${ef.minAssessmentYear}` });
              if (ef.maxAssessmentYear != null) chips.push({ key: "maxAssessmentYear", label: `Assessed ≤ ${ef.maxAssessmentYear}` });
              if (ef.minDescribedYear != null) chips.push({ key: "minDescribedYear", label: `Described ≥ ${ef.minDescribedYear}` });
              if (ef.maxDescribedYear != null) chips.push({ key: "maxDescribedYear", label: `Described ≤ ${ef.maxDescribedYear}` });
              return chips.map(c => (
                <button
                  key={`ef-${c.key}`}
                  onClick={() => setExactFilters({ [c.key]: null })}
                  className="px-3 py-1.5 text-sm font-medium rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 flex items-center gap-1 hover:opacity-80"
                >
                  {c.label}
                  <span className="text-sm">×</span>
                </button>
              ));
            })()}
            <span className="ml-auto text-sm md:text-base font-semibold text-zinc-700 dark:text-zinc-300 tabular-nums flex items-center gap-2">
              {speciesLoading && totalFiltered === 0 && !singleSpeciesPreview ? (
                <Spinner className="h-4 w-4" />
              ) : (
                <>{totalFiltered.toLocaleString()} species</>
              )}
            </span>
            {/* Assessed/Not Evaluated — a full view-mode switch (a different
                dataset entirely), moved here from the old dedicated stat-card
                row now that there isn't one. */}
            {onViewModeChange && (
              <div className="flex rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs shrink-0">
                <button
                  type="button"
                  onClick={() => onViewModeChange("reassessments")}
                  className={`px-2 py-1 font-medium transition-colors ${
                    !isNewAssessments
                      ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  }`}
                >
                  Assessed
                </button>
                <button
                  type="button"
                  onClick={() => onViewModeChange("new-assessments")}
                  className={`px-2 py-1 font-medium transition-colors ${
                    isNewAssessments
                      ? "bg-zinc-800 dark:bg-zinc-100 text-white dark:text-zinc-900"
                      : "bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-700"
                  }`}
                >
                  Not Evaluated
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Species table */}
        {speciesLoading && assessedSpecies.length === 0 && !singleSpeciesPreview ? (
          <div className="flex items-center justify-center py-12">
            <Spinner className="h-6 w-6" />
          </div>
        ) : (
        <>
        <div className="relative">
          {speciesLoading && !singleSpeciesPreview && (
            <div className="absolute inset-0 z-20 flex items-center justify-center">
              <Spinner className="h-6 w-6" />
            </div>
          )}
        {neTruncation && (
          <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 dark:border-amber-700/50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
            This group is very large — showing the first <strong>{neTruncation.shown.toLocaleString()}</strong>
            {neTruncation.neTotal > neTruncation.shown ? <> of {neTruncation.neTotal.toLocaleString()}</> : null} not-evaluated species. Open a sub-group (e.g. a class or order) to browse the rest.
          </div>
        )}
        <div
          ref={tableScrollRef}
          className={`bg-white dark:bg-zinc-900 rounded-xl shadow-sm border border-zinc-200 dark:border-zinc-800 overflow-x-auto transition-opacity duration-150 ${speciesLoading && !singleSpeciesPreview ? "opacity-50 pointer-events-none" : ""}`}
          onScroll={(e) => {
            e.currentTarget.style.setProperty('--scroll-left', `${e.currentTarget.scrollLeft}px`);
          }}
        >
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 dark:bg-zinc-800">
              <tr>
                <th className="sticky left-0 z-10 bg-zinc-50 dark:bg-zinc-800 px-2 py-3 text-center text-xs font-medium text-zinc-500 uppercase tracking-wider w-10">
                  <svg className="w-4 h-4 mx-auto text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                </th>
                <th className="sticky left-[40px] z-10 bg-zinc-50 dark:bg-zinc-800 px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  Species
                </th>
                {!isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("category")}
                >
                  <span className="flex items-center gap-1">
                    Category
                    {sortField === "category" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {!isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("year")}
                >
                  <span className="flex items-center gap-1">
                    Assess. Date
                    {(sortField === "year" || sortField === null) && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {isNewAssessments && (
                <th
                  className="px-2 md:px-4 py-3 text-left text-xs font-medium text-zinc-500 uppercase tracking-wider cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none whitespace-nowrap"
                  onClick={() => handleSort("describedYear")}
                >
                  <span className="flex items-center gap-1">
                    Year Described
                    {sortField === "describedYear" && (
                      <span className="text-emerald-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("totalGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    {isNewAssessments ? "GBIF Observations" : "GBIF Total"}
                    <GbifInfoTooltip />
                    {(sortField === "totalGbif" || (isNewAssessments && sortField === null)) && (
                      <span className={isNewAssessments ? "text-emerald-500" : "text-red-500"}>{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                {!isNewAssessments && (
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("newGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    GBIF Since Assess.
                    <HoverTooltip text="Records added after the assessment year (not the exact date). Uses the year following the assessment as the start of the range.">
                      <svg className="w-3 h-3 text-zinc-400 dark:text-zinc-500 cursor-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4M12 8h.01" />
                      </svg>
                    </HoverTooltip>
                    {sortField === "newGbif" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
                {!isNewAssessments && (
                <th
                  className="px-3 md:px-4 py-3 text-right text-xs font-medium text-zinc-500 uppercase tracking-wider min-w-[60px] cursor-pointer hover:text-zinc-700 dark:hover:text-zinc-300 select-none"
                  onClick={() => handleSort("pctNewGbif")}
                >
                  <span className="flex items-center justify-end gap-1">
                    % GBIF Since Assess.
                    {sortField === "pctNewGbif" && (
                      <span className="text-red-500">{sortDirection === "desc" ? "↓" : "↑"}</span>
                    )}
                  </span>
                </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {paginatedSpecies.map((s) => {
                const speciesKey = isNewAssessments ? Math.abs(s.id) : (s.sis_taxon_id ?? s.gbif_species_key ?? s.id);
                const assessmentDateObj = s.assessment_date ? new Date(s.assessment_date) : null;
                const assessmentYear = assessmentDateObj ? assessmentDateObj.getFullYear() : null;
                const yearsSinceAssessment = assessmentDateObj
                  ? Math.floor((Date.now() - assessmentDateObj.getTime()) / (365.25 * 24 * 60 * 60 * 1000))
                  : null;
                const details = speciesDetails[s.id];
                const gbifSpeciesKey = s.gbif_species_key || (details?.gbifUrl ? parseInt(details.gbifUrl.split('/').pop() || '0') : null);
                const isPinned = pinnedSet.has(speciesKey);
                const isDragging = draggedSpecies === speciesKey;
                const isDragOver = dragOverSpecies === speciesKey && draggedSpecies !== speciesKey;
                return (
                  <React.Fragment key={s.id}>
                  <tr
                    className={`hover:bg-zinc-50 dark:hover:bg-zinc-800/50 cursor-pointer ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : ""} ${isDragging ? "opacity-50" : ""} ${isDragOver ? "border-t-2 border-amber-500" : ""}`}
                    onClick={() => { setSelectedSpeciesKey(selectedSpeciesKey === speciesKey ? null : speciesKey); }}
                    draggable={isPinned && showOnlyStarred}
                    onDragStart={(e) => handleDragStart(e, speciesKey)}
                    onDragOver={(e) => handleDragOver(e, speciesKey)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, speciesKey)}
                    onDragEnd={handleDragEnd}
                  >
                    <td className={`sticky left-0 z-10 px-2 py-2 text-center ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
                      <div className="flex items-center justify-center gap-1">
                        {isPinned && showOnlyStarred && (
                          <span className="cursor-grab text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title="Drag to reorder">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm8-12a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0zm0 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z" />
                            </svg>
                          </span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePinned(speciesKey);
                          }}
                          className={`p-1 rounded transition-colors ${isPinned ? "text-amber-500 hover:text-amber-600" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600 dark:hover:text-amber-400"}`}
                          title={isPinned ? "Unpin species" : "Pin species"}
                        >
                          <svg className="w-4 h-4" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                      </div>
                    </td>
                    <td className={`sticky left-[40px] z-10 px-2 md:px-4 py-2 ${selectedSpeciesKey === speciesKey ? "bg-zinc-100 dark:bg-zinc-800" : "bg-white dark:bg-zinc-900"}`}>
                      <div className="flex items-center gap-2">
                        {/* iNat profile pic */}
                        {details?.inatDefaultImage === undefined ? (
                          <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex-shrink-0 flex items-center justify-center">
                            <span className="inline-block animate-spin h-4 w-4 border-2 border-zinc-400 border-t-transparent rounded-full" />
                          </div>
                        ) : details?.inatDefaultImage?.squareUrl ? (
                          <img
                            src={details.inatDefaultImage.squareUrl}
                            alt=""
                            className="w-8 h-8 md:w-10 md:h-10 object-cover rounded flex-shrink-0 cursor-pointer hover:ring-2 hover:ring-red-400"
                            onMouseEnter={(e) => {
                              const img = e.currentTarget;
                              const rect = img.getBoundingClientRect();
                              const preview = document.getElementById('image-preview');
                              if (preview) {
                                (preview as HTMLImageElement).src = details.inatDefaultImage?.mediumUrl || details.inatDefaultImage?.squareUrl || '';
                                preview.style.display = 'block';
                                const showBelow = rect.bottom + 192 + 8 < window.innerHeight;
                                preview.style.top = showBelow ? `${rect.bottom + 8}px` : `${rect.top - 192 - 8}px`;
                                preview.style.left = `${rect.left}px`;
                              }
                            }}
                            onMouseLeave={() => {
                              const preview = document.getElementById('image-preview');
                              if (preview) {
                                preview.style.display = 'none';
                              }
                            }}
                          />
                        ) : (
                          <div className="w-8 h-8 md:w-10 md:h-10 bg-zinc-100 dark:bg-zinc-800 rounded flex items-center justify-center text-zinc-400 flex-shrink-0">
                            <TaxaIcon taxonId={s.taxon_id || "all"} size={18} />
                          </div>
                        )}
                        <div className="min-w-0">
                          <span
                            className="italic font-medium text-zinc-900 dark:text-zinc-100 text-xs md:text-sm"
                          >
                            {s.scientific_name}
                          </span>
                          {s.common_name && (
                            <div className="text-zinc-500 dark:text-zinc-400 text-xs truncate max-w-[140px] md:max-w-none">
                              {s.common_name}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    {!isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 whitespace-nowrap">
                      {(() => {
                        const criteria = s.criteria ?? details?.criteria;
                        return criteria && !["DD", "LC", "NT", "EX", "EW", "NE"].includes(s.category) ? (
                        <HoverTooltip text={`${criteria}${explainCriteria(criteria)}`}>
                          <span
                            className="px-2 py-0.5 text-xs font-medium rounded cursor-help"
                            style={{
                              backgroundColor: CATEGORY_COLORS[s.category] + "20",
                              color: CATEGORY_COLORS[s.category],
                            }}
                          >
                            {s.category}
                          </span>
                        </HoverTooltip>
                      ) : (
                        <span
                          className="px-2 py-0.5 text-xs font-medium rounded"
                          style={{
                            backgroundColor: CATEGORY_COLORS[s.category] + "20",
                            color: s.category === "EX" || s.category === "EW" ? "#fff" : CATEGORY_COLORS[s.category],
                            ...(s.category === "EX" || s.category === "EW" ? { backgroundColor: CATEGORY_COLORS[s.category] } : {})
                          }}
                        >
                          {s.category}
                        </span>
                        );
                      })()}
                    </td>
                    )}
                    {!isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 text-zinc-600 dark:text-zinc-400 whitespace-nowrap">
                      {isNE(s) ? <span className="text-zinc-400">N/A</span> : (
                        <>
                          <HoverTooltip
                            text={`Published: ${s.year_published || "N/A"}`}
                          >
                            <span
                              className="cursor-help"
                            >
                              {s.assessment_date
                                ? new Date(s.assessment_date).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </span>
                          </HoverTooltip>
                          {yearsSinceAssessment !== null && isOutdated(s.assessment_date, dataAsOf) && (
                            <span className="ml-1 text-xs text-amber-600">({yearsSinceAssessment}y ago)</span>
                          )}
                        </>
                      )}
                    </td>
                    )}
                    {/* Year Described (CoL) */}
                    {isNewAssessments && (
                    <td className="px-2 md:px-4 py-3 text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {s.described_year ?? <span className="text-zinc-400">—</span>}
                    </td>
                    )}
                    {/* Total GBIF */}
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {details?.gbifOccurrences != null && details?.gbifUrl ? (
                        <a
                          href={`https://www.gbif.org/occurrence/search?taxon_key=${details.gbifUrl.split('/').pop()}&${GBIF_FILTERS}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {details.gbifOccurrences.toLocaleString()}
                        </a>
                      ) : s.gbif_occurrence_count != null && s.gbif_species_key ? (
                        <a
                          href={`https://www.gbif.org/occurrence/search?taxon_key=${s.gbif_species_key}&${GBIF_FILTERS}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {s.gbif_occurrence_count.toLocaleString()}
                        </a>
                      ) : details?.gbifMatchStatus?.matchType === 'HIGHERRANK' || details?.gbifMatchStatus?.matchType === 'NONE' ? (
                        <HoverTooltip
                          text={details.gbifMatchStatus.matchType === 'HIGHERRANK'
                            ? `Name not found in GBIF (matched to ${details.gbifMatchStatus.matchedRank?.toLowerCase() || 'higher rank'} instead). May be due to a taxonomic split, synonym, or naming difference.`
                            : "Species not found in GBIF. May be due to a taxonomic split, synonym, or naming difference."}
                        >
                          <span className="text-zinc-400 cursor-help">?</span>
                        </HoverTooltip>
                      ) : "—"}
                    </td>
                    {/* New GBIF */}
                    {!isNewAssessments && (
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {isNE(s) ? (
                        <span className="text-zinc-400">N/A</span>
                      ) : (() => {
                        const newObs = details?.gbifOccurrencesSinceAssessment ?? s.gbif_observations_after_assessment_year;
                        if (newObs == null) return "—";
                        const key = details?.gbifUrl?.split('/').pop() ?? s.gbif_species_key;
                        if (key && assessmentYear) {
                          return (
                            <a
                              href={`https://www.gbif.org/occurrence/search?taxon_key=${key}&year=${assessmentYear + 1},${currentYear}&${GBIF_FILTERS}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 underline decoration-dotted hover:decoration-solid"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {newObs.toLocaleString()}
                            </a>
                          );
                        }
                        return newObs.toLocaleString();
                      })()}
                    </td>
                    )}
                    {/* % New GBIF */}
                    {!isNewAssessments && (
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-400 text-sm tabular-nums whitespace-nowrap">
                      {isNE(s) ? <span className="text-zinc-400">N/A</span> : (() => {
                        const total = details?.gbifOccurrences ?? s.gbif_occurrence_count;
                        const newObs = details?.gbifOccurrencesSinceAssessment ?? s.gbif_observations_after_assessment_year;
                        if (total == null || total === 0 || newObs == null) return "—";
                        const pct = (newObs / total) * 100;
                        return `${pct < 1 && pct > 0 ? "<1" : Math.round(pct)}%`;
                      })()}
                    </td>
                    )}
                  </tr>
                  {selectedSpeciesKey === speciesKey && (
                    <tr>
                      <td colSpan={isNewAssessments ? 4 : 8} className="p-0 bg-zinc-50 dark:bg-zinc-800/30" style={{ width: 0 }}>
                        <div style={{ width: 'var(--view-width, 100%)', maxWidth: '100%', transform: 'translateX(var(--scroll-left, 0px))' }}>
                          {/* Tab bar */}
                          <div className="flex flex-wrap items-center border-b border-zinc-200 dark:border-zinc-700" onClick={(e) => e.stopPropagation()}>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "gbif" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("gbif")}
                                >
                                  {gbifSpeciesKey ? "GBIF" : "iNaturalist"}
                                </button>
                                {(assessmentYear || s.category === "NE") && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "literature" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("literature")}
                                  >
                                    Literature
                                  </button>
                                )}
                                {s.category !== "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "redlist" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("redlist")}
                                  >
                                    IUCN Red List
                                  </button>
                                )}
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "cites" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("cites")}
                                >
                                  CITES
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "col" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("col")}
                                >
                                  Catalogue of Life
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "eol" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("eol")}
                                >
                                  Encyclopedia of Life
                                </button>
                                <button
                                  className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "wikipedia" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                  onClick={() => setActiveDetailTab("wikipedia")}
                                >
                                  Wikipedia
                                </button>
                                {s.category === "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "assessors" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("assessors")}
                                  >
                                    Suggested Assessors
                                  </button>
                                )}
                                {s.category === "NE" && (
                                  <button
                                    className={`shrink-0 px-2 sm:px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${activeDetailTab === "reviewers" ? "text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                                    onClick={() => setActiveDetailTab("reviewers")}
                                  >
                                    Suggested Reviewers
                                  </button>
                                )}
                          </div>
                          {/* Content — overflow-hidden so child components don't extend past viewport */}
                          <div style={{ overflow: 'hidden', width: '100%' }}>
                          {gbifSpeciesKey ? (
                            (visitedTabs.has("gbif")) && (
                            <div style={{ display: activeDetailTab === "gbif" ? undefined : "none" }}>
                              <OccurrenceMapRow
                                speciesKey={gbifSpeciesKey}
                                mounted={mounted}
                                assessmentYear={assessmentYear}
                                assessmentDate={s.assessment_date}
                                assessmentId={s.assessment_id}
                                sisTaxonId={s.sis_taxon_id}
                                category={s.category}
                                criteria={s.criteria}
                                taxonGroup={s.taxon_group}
                                scientificName={s.scientific_name}
                                nativeCountriesRedList={s.countries}
                                previousAssessments={(s.sis_taxon_id ? assessmentHistory[s.sis_taxon_id] : null) ?? s.previous_assessments}
                                onEmpty={s.category === "NE" ? handleOccurrenceEmpty : undefined}
                              />
                            </div>
                            )
                          ) : (visitedTabs.has("gbif")) && (
                            <div style={{ display: activeDetailTab === "gbif" ? undefined : "none" }}>
                              <InatObservationsPanel scientificName={s.scientific_name} mounted={mounted} onEmpty={s.category === "NE" ? handleOccurrenceEmpty : undefined} />
                            </div>
                          )}
                          {(assessmentYear || s.category === "NE") && (visitedTabs.has("literature")) && (
                            <div className="p-4" style={{ display: activeDetailTab === "literature" ? undefined : "none" }}>
                              <NewLiteratureSinceAssessment
                                scientificName={s.scientific_name}
                                assessmentYear={assessmentYear ?? 0}
                              />
                            </div>
                          )}
                          {(visitedTabs.has("col")) && (() => {
                            const syn = synonymsBySpecies[synKey(s) ?? ""];
                            return (
                            <div style={{ display: activeDetailTab === "col" ? undefined : "none" }}>
                              {!syn ? (
                                <div className="flex items-center justify-center p-8">
                                  <svg className="w-5 h-5 animate-spin text-zinc-400" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                  </svg>
                                </div>
                              ) : !syn.col_id ? (
                                <div className="text-sm text-zinc-400 italic p-4">No Catalogue of Life match for <span className="italic">{s.scientific_name}</span>.</div>
                              ) : (
                                <div className="p-4 text-sm space-y-3">
                                  <div>
                                    <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Accepted name (CoL)</div>
                                    <span className="italic text-zinc-900 dark:text-zinc-100">{syn.accepted_name ?? s.scientific_name}</span>
                                    {syn.accepted_authorship && <span className="text-zinc-500 dark:text-zinc-400"> {syn.accepted_authorship}</span>}
                                  </div>
                                  <div>
                                    <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1">Synonyms ({syn.synonyms.length})</div>
                                    {syn.synonyms.length === 0 ? (
                                      <div className="text-zinc-500 dark:text-zinc-400">No synonyms recorded.</div>
                                    ) : (
                                      <ul className="space-y-0.5">
                                        {syn.synonyms.map((x, i) => (
                                          <li key={i}>
                                            <span className="italic text-zinc-700 dark:text-zinc-300">{x.name}</span>
                                            {x.authorship && <span className="text-zinc-500 dark:text-zinc-400"> {x.authorship}</span>}
                                            {x.status === "ambiguous synonym" && <span className="ml-1 text-xs text-amber-600 dark:text-amber-500">(ambiguous)</span>}
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                  <a
                                    href={`https://www.catalogueoflife.org/data/taxon/${syn.col_id}`}
                                    target="_blank" rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline"
                                  >
                                    View on Catalogue of Life ↗
                                  </a>
                                </div>
                              )}
                            </div>
                            );
                          })()}
                          {(visitedTabs.has("eol")) && (
                            <div style={{ display: activeDetailTab === "eol" ? undefined : "none" }}>
                              <EolSummary scientificName={s.scientific_name} />
                            </div>
                          )}
                          {s.category !== "NE" && (visitedTabs.has("redlist")) && (
                            <div style={{ display: activeDetailTab === "redlist" ? undefined : "none" }}>
                              <RedListAssessments
                                sisTaxonId={s.sis_taxon_id ?? undefined}
                                currentAssessmentId={s.assessment_id ?? 0}
                                currentCategory={s.category}
                                currentAssessmentDate={s.assessment_date}
                                previousAssessments={((s.sis_taxon_id ? assessmentHistory[s.sis_taxon_id] : null) ?? s.previous_assessments ?? []).map((a) => ({ year: a.year, assessment_id: a.id, category: a.category, assessors: a.assessors, reviewers: a.reviewers }))}
                                speciesUrl={`https://www.iucnredlist.org/species/${s.sis_taxon_id}/${s.assessment_id}`}
                              />
                            </div>
                          )}
                          {(visitedTabs.has("wikipedia")) && (
                          <div style={{ display: activeDetailTab === "wikipedia" ? undefined : "none" }}>
                            <WikipediaSummary scientificName={s.scientific_name} />
                          </div>
                          )}
                          {(visitedTabs.has("cites")) && (
                          <div style={{ display: activeDetailTab === "cites" ? undefined : "none" }}>
                            <CitesSummary scientificName={s.scientific_name} />
                          </div>
                          )}
                          {s.category === "NE" && (visitedTabs.has("assessors")) && (
                            <div style={{ display: activeDetailTab === "assessors" ? undefined : "none" }}>
                              <AssessorCandidatesTable
                                taxaId={[...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group}
                                taxaName={findNode([...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group)?.name ?? (selectedSubgroups.size > 0 ? dynamicNodeDisplayName([...selectedSubgroups][0]) : undefined) ?? TAXA_BY_ID[[...selectedTaxa][0] ?? s.taxon_group]?.name ?? "Species"}
                                countries={s.countries}
                              />
                            </div>
                          )}
                          {s.category === "NE" && (visitedTabs.has("reviewers")) && (
                            <div style={{ display: activeDetailTab === "reviewers" ? undefined : "none" }}>
                              <ReviewerCandidatesTable
                                taxaId={[...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group}
                                taxaName={findNode([...selectedSubgroups][0] ?? [...selectedTaxa][0] ?? s.taxon_group)?.name ?? (selectedSubgroups.size > 0 ? dynamicNodeDisplayName([...selectedSubgroups][0]) : undefined) ?? TAXA_BY_ID[[...selectedTaxa][0] ?? s.taxon_group]?.name ?? "Species"}
                                countries={s.countries}
                              />
                            </div>
                          )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                  </React.Fragment>
                );
              })}
              {totalFiltered === 0 && !speciesLoading && (
                <tr>
                  <td colSpan={isNewAssessments ? 4 : 8} className="px-4 py-8 text-center text-zinc-500">
                    No species found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        </div>

        {/* Pagination */}
        {totalFiltered > 0 && (
          <div className="flex flex-col sm:flex-row items-center justify-between px-3 md:px-4 py-3 border-t border-zinc-200 dark:border-zinc-800 gap-2">
            <div className="flex items-center gap-3">
              <div className="text-xs md:text-sm text-zinc-500">
                {(currentPage - 1) * PAGE_SIZE + 1}-{Math.min(currentPage * PAGE_SIZE, totalFiltered)} of {totalFiltered}
              </div>
              <label className="flex items-center gap-1.5 text-xs md:text-sm text-zinc-500">
                <span>Rows</span>
                <select
                  value={pageSize}
                  onChange={(e) => {
                    setPageSize(Number(e.target.value));
                    setCurrentPage(1);
                  }}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-2 py-1 text-xs md:text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 focus:outline-none cursor-pointer"
                >
                  {[1, 2, 3, 5, 10, 25, 50, 100].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-3 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Prev
                </button>
                <span className="text-xs md:text-sm text-zinc-600 dark:text-zinc-400">
                  {currentPage} / {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 py-1 text-sm rounded-lg border border-zinc-200 dark:border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  Next
                </button>
              </div>
            )}
          </div>
        )}
        </>
        )}
      </div>
      </div>
      ))}

      {/* Fixed image preview portal */}
      <img
        id="image-preview"
        alt=""
        className="fixed z-[9999] w-48 h-48 object-cover rounded shadow-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 pointer-events-none"
        style={{ display: 'none' }}
      />
    </div>
  );
}
