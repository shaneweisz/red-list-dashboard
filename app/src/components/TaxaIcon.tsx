/**
 * Icons for each taxon group using react-icons.
 *
 * Canonical IDs are mapped once; prefixed duplicates (e.g. "inv-beetles",
 * "pl-flowering_plants", "fu-mushrooms") are resolved by stripping the
 * prefix before lookup.
 */

import React, { CSSProperties } from "react";
import { IconBaseProps } from "react-icons";
import {
  FaPaw,
  FaDove,
  FaFish,
  FaFrog,
  FaLeaf,
  FaBug,
  FaGlobeAmericas,
} from "react-icons/fa";
import {
  GiAlgae,
  GiBat,
  GiBee,
  GiButterfly,
  GiCoral,
  GiCrab,
  GiCricket,
  GiCrocJaws,
  GiDeer,
  GiDragonfly,
  GiEarthWorm,
  GiFern,
  GiFlowers,
  GiFly,
  GiGorilla,
  GiHedgehog,
  GiHighGrass,
  GiHorseHead,
  GiKangaroo,
  GiLilyPads,
  GiLotus,
  GiMushroom,
  GiMushroomGills,
  GiMushrooms,
  GiNautilusShell,
  GiOak,
  GiPalmTree,
  GiPangolin,
  GiPineTree,
  GiPlantSeed,
  GiRabbit,
  GiRat,
  GiSalamander,
  GiScarabBeetle,
  GiSeaStar,
  GiSharkFin,
  GiSnake,
  GiSpermWhale,
  GiSpiderAlt,
  GiSunflower,
  GiTurtle,
  GiWheat,
  GiWolfHead,
} from "react-icons/gi";

// ---------------------------------------------------------------------------
// Canonical taxon-id → icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, React.ComponentType<IconBaseProps>> = {
  // Top-level taxa
  all: FaGlobeAmericas,
  mammalia: FaPaw,
  aves: FaDove,
  reptilia: GiSnake,
  amphibia: FaFrog,
  fishes: FaFish,
  invertebrates: FaBug,
  plantae: FaLeaf,
  fungi: GiMushroom,

  // Mammal subgroups
  rodents: GiRat,
  bats: GiBat,
  insectivores: GiHedgehog,
  primates: GiGorilla,
  marsupials: GiKangaroo,
  carnivores: GiWolfHead,
  "even-toed-ungulates": GiDeer,
  "rabbits-hares": GiRabbit,
  "whales-dolphins": GiSpermWhale,
  "odd-toed-ungulates": GiHorseHead,
  pangolins: GiPangolin,
  "other-mammals": FaPaw,

  // Reptile subgroups
  "lizards-snakes": GiSnake,
  "turtles-tortoises": GiTurtle,
  crocodilians: GiCrocJaws,

  // Amphibian subgroups
  "frogs-toads": FaFrog,
  "salamanders-newts": GiSalamander,
  caecilians: FaFrog,

  // Fish subgroups
  "bony-fish": FaFish,
  "sharks-rays": GiSharkFin,
  "jawless-fish": FaFish,

  // Insect subgroups
  insecta: FaBug,
  beetles: GiScarabBeetle,
  "butterflies-moths": GiButterfly,
  "flies-mosquitoes": GiFly,
  "bees-wasps-ants": GiBee,
  "true-bugs": FaBug,
  "grasshoppers-crickets": GiCricket,
  "dragonflies-damselflies": GiDragonfly,
  "other-insects": FaBug,

  // Other invertebrate subgroups
  arachnida: GiSpiderAlt,
  mollusca: GiNautilusShell,
  crustacea: GiCrab,
  corals: GiCoral,
  other_invertebrates: FaBug,
  echinoderms: GiSeaStar,
  worms: GiEarthWorm,
  "other-invertebrates-catch-all": FaBug,
  velvet_worms: GiEarthWorm,
  horseshoe_crabs: GiCrab,

  // Plant subgroups (raw class/order taxonomy)
  flowering_plants: GiFlowers,
  magnoliopsida: GiFlowers,
  liliopsida: GiWheat,
  "other-magnoliopsida": GiFlowers,
  // Eudicot orders with recognisable icons
  asterales: GiSunflower,
  fabales: GiPlantSeed,
  rosales: GiOak,
  fagales: GiOak,
  // Monocot orders with recognisable icons
  asparagales: GiLotus,
  poales: GiWheat,
  arecales: GiPalmTree,
  alismatales: GiLilyPads,
  gymnosperms: GiPineTree,
  pinopsida: GiPineTree,
  cycadopsida: GiPalmTree,
  gnetopsida: GiPineTree,
  ginkgoopsida: GiFern,
  ferns_and_allies: GiFern,
  polypodiopsida: GiFern,
  lycopodiopsida: GiFern,
  mosses: GiHighGrass,
  bryopsida: GiHighGrass,
  jungermanniopsida: GiHighGrass,
  marchantiopsida: GiHighGrass,
  anthocerotopsida: GiHighGrass,
  sphagnopsida: GiHighGrass,
  green_algae: GiAlgae,
  red_algae: GiAlgae,
  brown_algae: GiAlgae,

  // Fungi subgroups
  mushrooms: GiMushroom,
  "moulds-yeasts-cup": GiMushroomGills,
  "bracket-mushroom-fungi": GiMushrooms,
};

// Prefixes applied to subgroup IDs to disambiguate across parent taxa
const KNOWN_PREFIXES = ["inv-", "pl-", "fu-"];

function resolveIcon(
  taxonId: string,
): React.ComponentType<IconBaseProps> | undefined {
  // Try exact match first
  const exact = ICON_MAP[taxonId];
  if (exact) return exact;

  // Strip known prefix and try again
  for (const prefix of KNOWN_PREFIXES) {
    if (taxonId.startsWith(prefix)) {
      return ICON_MAP[taxonId.slice(prefix.length)];
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TaxaIconProps {
  taxonId: string;
  className?: string;
  size?: number;
  style?: CSSProperties;
}

export default function TaxaIcon({
  taxonId,
  className = "",
  size = 16,
  style,
}: TaxaIconProps) {
  const iconProps = { size, className, style };
  return React.createElement(resolveIcon(taxonId) ?? FaLeaf, iconProps);
}
