export type Locale = "en" | "fr" | "es" | "pt";

export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
};

export interface Translations {
  // Page header
  dashboardTitle: string;
  dashboardSubtitle: string;
  reassessments: string;
  newAssessments: string;
  loadingView: string;

  // Theme
  toggleTheme: string;
  themeLabel: string;

  // Language
  language: string;

  // Taxa names
  allSpecies: string;
  mammals: string;
  birds: string;
  reptiles: string;
  amphibians: string;
  fishes: string;
  invertebrates: string;
  plants: string;
  fungi: string;

  // IUCN categories
  extinct: string;
  extinctInTheWild: string;
  criticallyEndangered: string;
  endangered: string;
  vulnerable: string;
  nearThreatened: string;
  leastConcern: string;
  dataDeficient: string;
  notEvaluated: string;

  // Table headers
  estDescribed: string;
  numAssessed: string;
  pctAssessed: string;
  numOutdated: string;
  pctOutdated: string;
  riskCategoryBreakdown: string;

  // Search & filters
  searchSpecies: string;
  riskCategory: string;
  yearsSinceAssessed: string;
  country: string;
  gbifObservations: string;

  // Species actions
  pinSpecies: string;
  unpinSpecies: string;
  dragToReorder: string;
  starred: string;
  allSections: string;

  // GBIF
  showNotEvaluated: string;
  georeferenced: string;
  included: string;
  excluded: string;

  // Tabs
  gbifMap: string;
  literature: string;
  redList: string;
  cites: string;

  // Status messages
  loading: string;
  failedToLoad: string;
  notFoundInGbif: string;

  // Taxa hierarchy subgroups
  lizardsAndSnakes: string;
  turtlesAndTortoises: string;
  crocodilians: string;
  frogsAndToads: string;
  salamandersAndNewts: string;
  caecilians: string;
  bonyFish: string;
  sharksAndRays: string;
  jawlessFish: string;
}

const en: Translations = {
  dashboardTitle: "IUCN Red List Assessments Dashboard",
  dashboardSubtitle: "Click taxa rows to filter, use charts and search to explore species. Cmd/Ctrl+click to multiselect.",
  reassessments: "Reassessments",
  newAssessments: "New Assessments",
  loadingView: "Loading view...",
  toggleTheme: "Toggle theme",
  themeLabel: "Theme",
  language: "Language",

  allSpecies: "All Species",
  mammals: "Mammals",
  birds: "Birds",
  reptiles: "Reptiles",
  amphibians: "Amphibians",
  fishes: "Fishes",
  invertebrates: "Invertebrates",
  plants: "Plants",
  fungi: "Fungi",

  extinct: "Extinct",
  extinctInTheWild: "Extinct in the Wild",
  criticallyEndangered: "Critically Endangered",
  endangered: "Endangered",
  vulnerable: "Vulnerable",
  nearThreatened: "Near Threatened",
  leastConcern: "Least Concern",
  dataDeficient: "Data Deficient",
  notEvaluated: "Not Evaluated",

  estDescribed: "Est. # Described",
  numAssessed: "# Assessed",
  pctAssessed: "% Assessed",
  numOutdated: "# Outdated (10+Y)",
  pctOutdated: "% Outdated",
  riskCategoryBreakdown: "Risk Category Breakdown",

  searchSpecies: "Search species...",
  riskCategory: "Risk Category",
  yearsSinceAssessed: "Years Since Assessed",
  country: "Country",
  gbifObservations: "GBIF Observations",

  pinSpecies: "Pin species",
  unpinSpecies: "Unpin species",
  dragToReorder: "Drag to reorder",
  starred: "Starred",
  allSections: "All Sections",

  showNotEvaluated: "Show Not Evaluated species from GBIF",
  georeferenced: "Georeferenced GBIF records only:",
  included: "Included:",
  excluded: "Excluded:",

  gbifMap: "GBIF Map",
  literature: "Literature",
  redList: "Red List",
  cites: "CITES",

  loading: "Loading...",
  failedToLoad: "Failed to load",
  notFoundInGbif: "Not found in GBIF",

  lizardsAndSnakes: "Lizards & Snakes",
  turtlesAndTortoises: "Turtles & Tortoises",
  crocodilians: "Crocodilians",
  frogsAndToads: "Frogs & Toads",
  salamandersAndNewts: "Salamanders & Newts",
  caecilians: "Caecilians",
  bonyFish: "Bony Fish",
  sharksAndRays: "Sharks & Rays",
  jawlessFish: "Jawless Fish",
};

const fr: Translations = {
  dashboardTitle: "Tableau de bord des évaluations de la Liste rouge de l'UICN",
  dashboardSubtitle: "Cliquez sur les lignes de taxons pour filtrer, utilisez les graphiques et la recherche pour explorer les espèces. Cmd/Ctrl+clic pour sélection multiple.",
  reassessments: "Réévaluations",
  newAssessments: "Nouvelles évaluations",
  loadingView: "Chargement de la vue...",
  toggleTheme: "Changer le thème",
  themeLabel: "Thème",
  language: "Langue",

  allSpecies: "Toutes les espèces",
  mammals: "Mammifères",
  birds: "Oiseaux",
  reptiles: "Reptiles",
  amphibians: "Amphibiens",
  fishes: "Poissons",
  invertebrates: "Invertébrés",
  plants: "Plantes",
  fungi: "Champignons",

  extinct: "Éteinte",
  extinctInTheWild: "Éteinte à l'état sauvage",
  criticallyEndangered: "En danger critique",
  endangered: "En danger",
  vulnerable: "Vulnérable",
  nearThreatened: "Quasi menacée",
  leastConcern: "Préoccupation mineure",
  dataDeficient: "Données insuffisantes",
  notEvaluated: "Non évaluée",

  estDescribed: "Nb. estimé décrites",
  numAssessed: "Nb. évaluées",
  pctAssessed: "% évaluées",
  numOutdated: "Nb. obsolètes (10+ ans)",
  pctOutdated: "% obsolètes",
  riskCategoryBreakdown: "Répartition par catégorie de risque",

  searchSpecies: "Rechercher des espèces...",
  riskCategory: "Catégorie de risque",
  yearsSinceAssessed: "Années depuis l'évaluation",
  country: "Pays",
  gbifObservations: "Observations GBIF",

  pinSpecies: "Épingler l'espèce",
  unpinSpecies: "Désépingler l'espèce",
  dragToReorder: "Glisser pour réorganiser",
  starred: "Épinglées",
  allSections: "Toutes les sections",

  showNotEvaluated: "Afficher les espèces non évaluées du GBIF",
  georeferenced: "Enregistrements GBIF géoréférencés uniquement :",
  included: "Inclus :",
  excluded: "Exclus :",

  gbifMap: "Carte GBIF",
  literature: "Littérature",
  redList: "Liste rouge",
  cites: "CITES",

  loading: "Chargement...",
  failedToLoad: "Échec du chargement",
  notFoundInGbif: "Non trouvé dans GBIF",

  lizardsAndSnakes: "Lézards et serpents",
  turtlesAndTortoises: "Tortues",
  crocodilians: "Crocodiliens",
  frogsAndToads: "Grenouilles et crapauds",
  salamandersAndNewts: "Salamandres et tritons",
  caecilians: "Cécilies",
  bonyFish: "Poissons osseux",
  sharksAndRays: "Requins et raies",
  jawlessFish: "Poissons sans mâchoire",
};

const es: Translations = {
  dashboardTitle: "Panel de evaluaciones de la Lista Roja de la UICN",
  dashboardSubtitle: "Haga clic en las filas de taxones para filtrar, use gráficos y búsqueda para explorar especies. Cmd/Ctrl+clic para selección múltiple.",
  reassessments: "Reevaluaciones",
  newAssessments: "Nuevas evaluaciones",
  loadingView: "Cargando vista...",
  toggleTheme: "Cambiar tema",
  themeLabel: "Tema",
  language: "Idioma",

  allSpecies: "Todas las especies",
  mammals: "Mamíferos",
  birds: "Aves",
  reptiles: "Reptiles",
  amphibians: "Anfibios",
  fishes: "Peces",
  invertebrates: "Invertebrados",
  plants: "Plantas",
  fungi: "Hongos",

  extinct: "Extinta",
  extinctInTheWild: "Extinta en estado silvestre",
  criticallyEndangered: "En peligro crítico",
  endangered: "En peligro",
  vulnerable: "Vulnerable",
  nearThreatened: "Casi amenazada",
  leastConcern: "Preocupación menor",
  dataDeficient: "Datos insuficientes",
  notEvaluated: "No evaluada",

  estDescribed: "Núm. estimado descritas",
  numAssessed: "Núm. evaluadas",
  pctAssessed: "% evaluadas",
  numOutdated: "Núm. desactualizadas (10+ años)",
  pctOutdated: "% desactualizadas",
  riskCategoryBreakdown: "Desglose por categoría de riesgo",

  searchSpecies: "Buscar especies...",
  riskCategory: "Categoría de riesgo",
  yearsSinceAssessed: "Años desde la evaluación",
  country: "País",
  gbifObservations: "Observaciones GBIF",

  pinSpecies: "Fijar especie",
  unpinSpecies: "Desfijar especie",
  dragToReorder: "Arrastrar para reordenar",
  starred: "Fijadas",
  allSections: "Todas las secciones",

  showNotEvaluated: "Mostrar especies no evaluadas del GBIF",
  georeferenced: "Solo registros GBIF georreferenciados:",
  included: "Incluidos:",
  excluded: "Excluidos:",

  gbifMap: "Mapa GBIF",
  literature: "Literatura",
  redList: "Lista Roja",
  cites: "CITES",

  loading: "Cargando...",
  failedToLoad: "Error al cargar",
  notFoundInGbif: "No encontrado en GBIF",

  lizardsAndSnakes: "Lagartos y serpientes",
  turtlesAndTortoises: "Tortugas",
  crocodilians: "Cocodrílidos",
  frogsAndToads: "Ranas y sapos",
  salamandersAndNewts: "Salamandras y tritones",
  caecilians: "Cecilias",
  bonyFish: "Peces óseos",
  sharksAndRays: "Tiburones y rayas",
  jawlessFish: "Peces sin mandíbula",
};

const pt: Translations = {
  dashboardTitle: "Painel de avaliações da Lista Vermelha da UICN",
  dashboardSubtitle: "Clique nas linhas de táxons para filtrar, use gráficos e pesquisa para explorar espécies. Cmd/Ctrl+clique para seleção múltipla.",
  reassessments: "Reavaliações",
  newAssessments: "Novas avaliações",
  loadingView: "Carregando vista...",
  toggleTheme: "Alternar tema",
  themeLabel: "Tema",
  language: "Idioma",

  allSpecies: "Todas as espécies",
  mammals: "Mamíferos",
  birds: "Aves",
  reptiles: "Répteis",
  amphibians: "Anfíbios",
  fishes: "Peixes",
  invertebrates: "Invertebrados",
  plants: "Plantas",
  fungi: "Fungos",

  extinct: "Extinta",
  extinctInTheWild: "Extinta na natureza",
  criticallyEndangered: "Criticamente em perigo",
  endangered: "Em perigo",
  vulnerable: "Vulnerável",
  nearThreatened: "Quase ameaçada",
  leastConcern: "Pouco preocupante",
  dataDeficient: "Dados insuficientes",
  notEvaluated: "Não avaliada",

  estDescribed: "Núm. estimado descritas",
  numAssessed: "Núm. avaliadas",
  pctAssessed: "% avaliadas",
  numOutdated: "Núm. desatualizadas (10+ anos)",
  pctOutdated: "% desatualizadas",
  riskCategoryBreakdown: "Distribuição por categoria de risco",

  searchSpecies: "Pesquisar espécies...",
  riskCategory: "Categoria de risco",
  yearsSinceAssessed: "Anos desde a avaliação",
  country: "País",
  gbifObservations: "Observações GBIF",

  pinSpecies: "Fixar espécie",
  unpinSpecies: "Desfixar espécie",
  dragToReorder: "Arrastar para reordenar",
  starred: "Fixadas",
  allSections: "Todas as seções",

  showNotEvaluated: "Mostrar espécies não avaliadas do GBIF",
  georeferenced: "Apenas registros GBIF georreferenciados:",
  included: "Incluídos:",
  excluded: "Excluídos:",

  gbifMap: "Mapa GBIF",
  literature: "Literatura",
  redList: "Lista Vermelha",
  cites: "CITES",

  loading: "Carregando...",
  failedToLoad: "Falha ao carregar",
  notFoundInGbif: "Não encontrado no GBIF",

  lizardsAndSnakes: "Lagartos e serpentes",
  turtlesAndTortoises: "Tartarugas",
  crocodilians: "Crocodilianos",
  frogsAndToads: "Sapos e rãs",
  salamandersAndNewts: "Salamandras e tritões",
  caecilians: "Cecílias",
  bonyFish: "Peixes ósseos",
  sharksAndRays: "Tubarões e raias",
  jawlessFish: "Peixes sem mandíbula",
};

export const translations: Record<Locale, Translations> = { en, fr, es, pt };

// Helper to get translated taxon name by taxon ID
const TAXON_NAME_KEYS: Record<string, keyof Translations> = {
  all: "allSpecies",
  mammalia: "mammals",
  aves: "birds",
  reptilia: "reptiles",
  amphibia: "amphibians",
  fishes: "fishes",
  invertebrates: "invertebrates",
  plantae: "plants",
  fungi: "fungi",
};

export function getTranslatedTaxonName(locale: Locale, taxonId: string): string | null {
  const key = TAXON_NAME_KEYS[taxonId];
  if (!key) return null;
  return translations[locale][key];
}

// Helper to get translated IUCN category name by code
const CATEGORY_NAME_KEYS: Record<string, keyof Translations> = {
  EX: "extinct",
  EW: "extinctInTheWild",
  CR: "criticallyEndangered",
  EN: "endangered",
  VU: "vulnerable",
  NT: "nearThreatened",
  LC: "leastConcern",
  DD: "dataDeficient",
  NE: "notEvaluated",
};

export function getTranslatedCategoryName(locale: Locale, code: string): string {
  const key = CATEGORY_NAME_KEYS[code];
  if (!key) return code;
  return translations[locale][key];
}
