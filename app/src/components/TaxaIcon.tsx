/**
 * Icons for each taxon group using react-icons.
 *
 * Canonical IDs are mapped once; prefixed duplicates (e.g. "inv-beetles",
 * "pl-flowering_plants", "fu-mushrooms") are resolved by stripping the
 * prefix before lookup.
 */

import { CSSProperties } from "react";
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
  GiAngularSpider,
  GiBat,
  GiBee,
  GiBirdTwitter,
  GiButterfly,
  GiChicken,
  GiCoral,
  GiCrab,
  GiCricket,
  GiCrocJaws,
  GiDeer,
  GiDragonfly,
  GiDuck,
  GiEagleHead,
  GiEarthWorm,
  GiFern,
  GiFlowers,
  GiFly,
  GiGorilla,
  GiHedgehog,
  GiHeron,
  GiHighGrass,
  GiHorseHead,
  GiHummingbird,
  GiKangaroo,
  GiLilyPads,
  GiLotus,
  GiMushroom,
  GiMushroomGills,
  GiMushrooms,
  GiNautilusShell,
  GiOak,
  GiOwl,
  GiPalmTree,
  GiPangolin,
  GiParrotHead,
  GiPineTree,
  GiPlantSeed,
  GiRabbit,
  GiRat,
  GiSalamander,
  GiScarabBeetle,
  GiSeaStar,
  GiSeagull,
  GiSharkFin,
  GiSnake,
  GiSpermWhale,
  GiSpiderAlt,
  GiSunflower,
  GiToucan,
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

  // Bird subgroups
  songbirds: GiBirdTwitter,
  "hummingbirds-swifts": GiHummingbird,
  "woodpeckers-toucans": GiToucan,
  parrots: GiParrotHead,
  shorebirds: FaDove,
  "pigeons-doves": FaDove,
  raptors: GiEagleHead,
  gamebirds: GiChicken,
  owls: GiOwl,
  waterbirds: GiDuck,
  seabirds: GiSeagull,
  "herons-storks": GiHeron,
  "other-birds": FaDove,

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

  // Plant subgroups
  flowering_plants: GiFlowers,
  "orchids-lilies-bulbs": GiLotus,
  "composites-wildflowers": GiSunflower,
  legumes: GiPlantSeed,
  "grasses-cereals": GiWheat,
  "palms-relatives": GiPalmTree,
  "aquatic-flowering": GiLilyPads,
  "broadleaf-trees-shrubs": GiOak,
  "other-flowering-plants": GiFlowers,
  gymnosperms: GiPineTree,
  ferns_and_allies: GiFern,
  mosses: GiHighGrass,
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
  const Icon = resolveIcon(taxonId) ?? FaLeaf;
  return <Icon {...iconProps} />;
}
