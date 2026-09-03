/**
 * The IUCN Habitats Classification Scheme.
 *
 * Shared between the habitat filter on the dashboard and the habitat map
 * overlay, which reads these same codes out of Jung et al.'s raster — one
 * table, so a class can't end up named two different things in two places.
 */
// IUCN habitat classification (18 top-level categories, 126 codes total) — see
// https://www.iucnredlist.org/resources/habitat-classification-scheme. A handful
// of codes go a 3rd level deep (e.g. 11.1.1/11.1.2 under 11.1, 9.8.1-9.8.6 under
// 9.8); those are intentionally folded into their 2nd-level parent rather than
// given their own drill row, mirroring THREAT_CATEGORIES' 2-level depth — the
// prefix-based matching (code.startsWith(sel + ".")) still counts a species
// under e.g. "11.1.1" when "11.1" is selected, it just isn't its own pill.
export const HABITAT_CATEGORIES: { code: string; label: string; children: { code: string; label: string }[] }[] = [
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

/** Every code in the scheme, level 1 and level 2, by its dotted form. */
const LABELS_BY_CODE = new Map<string, string>(
  HABITAT_CATEGORIES.flatMap((category) => [
    [category.code, category.label] as [string, string],
    ...category.children.map((child) => [child.code, child.label] as [string, string]),
  ])
);

/**
 * The scheme's own name for a code — "Forest - Subtropical/Tropical Moist
 * Montane" for 1.9. Falls back to the level-1 name where a sub-code isn't in
 * the scheme, since the broad habitat is still true, and returns null rather
 * than inventing anything when the code is unknown entirely.
 */
export function habitatCodeLabel(code: string): string | null {
  const exact = LABELS_BY_CODE.get(code);
  if (exact) return exact;
  const top = code.split(".")[0];
  return LABELS_BY_CODE.get(top) ?? null;
}
