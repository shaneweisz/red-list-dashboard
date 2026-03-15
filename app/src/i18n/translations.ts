export type Locale = string;

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

  // Species list table columns
  columnSpecies: string;
  columnCategory: string;
  columnAssessDate: string;
  columnTotalGbif: string;
  columnNewGbif: string;
  columnPctNewGbif: string;

  // Filter bar
  clearAll: string;
  speciesCount: string;
  assessorFilter: string;
  reviewerFilter: string;
  failedToLoadData: string;

  // Red List Assessments panel
  redListAssessments: string;
  compare: string;
  exitComparison: string;
  viewOnIUCN: string;
  loadingAssessment: string;
  loadingComparison: string;
  failedToLoadAssessment: string;
  retry: string;
  noEarlierAssessment: string;
  noNarrativeChanges: string;
  statusImproved: string;
  statusWorsened: string;
  categoryChangedLabel: string;
  categoryUnchanged: string;
  changedLabel: string;
  notAvailable: string;

  // Assessment narrative section titles
  narrativeRationale: string;
  narrativePopulation: string;
  narrativeHabitatEcology: string;
  narrativeThreats: string;
  narrativeConservationActions: string;
  narrativeUseTrade: string;
  narrativeGeographicRange: string;

  // Assessment detail labels
  assessedLabel: string;
  publishedLabel: string;
  systemsLabel: string;
  assessorsLabel: string;
  reviewersLabel: string;
  habitatsLabel: string;
  threatClassificationLabel: string;
  possiblyExtinct: string;
  possiblyExtinctInTheWild: string;
  trendLabel: string;
  criteriaLabel: string;
  noNarrativeDataAvailable: string;
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

  columnSpecies: "Species",
  columnCategory: "Category",
  columnAssessDate: "Assess. Date",
  columnTotalGbif: "Total GBIF",
  columnNewGbif: "New GBIF",
  columnPctNewGbif: "% New GBIF",

  clearAll: "Clear all",
  speciesCount: "species",
  assessorFilter: "assessor",
  reviewerFilter: "reviewer",
  failedToLoadData: "Failed to load Red List data",

  redListAssessments: "Red List Assessments",
  compare: "Compare",
  exitComparison: "Exit comparison",
  viewOnIUCN: "View on IUCN",
  loadingAssessment: "Loading assessment...",
  loadingComparison: "Loading comparison assessment...",
  failedToLoadAssessment: "Failed to load assessment details.",
  retry: "Retry",
  noEarlierAssessment: "No previous assessment to compare with. This is the earliest assessment.",
  noNarrativeChanges: "No changes in narrative text between these assessments.",
  statusImproved: "Status improved",
  statusWorsened: "Status worsened",
  categoryChangedLabel: "Category changed",
  categoryUnchanged: "Category unchanged between assessments",
  changedLabel: "changed",
  notAvailable: "Not available",

  narrativeRationale: "Rationale",
  narrativePopulation: "Population",
  narrativeHabitatEcology: "Habitat & Ecology",
  narrativeThreats: "Threats",
  narrativeConservationActions: "Conservation Actions",
  narrativeUseTrade: "Use & Trade",
  narrativeGeographicRange: "Geographic Range",

  assessedLabel: "Assessed",
  publishedLabel: "Published",
  systemsLabel: "Systems",
  assessorsLabel: "Assessors",
  reviewersLabel: "Reviewers",
  habitatsLabel: "Habitats",
  threatClassificationLabel: "Threat Classification",
  possiblyExtinct: "Possibly Extinct",
  possiblyExtinctInTheWild: "Possibly Extinct in the Wild",
  trendLabel: "Trend",
  criteriaLabel: "Criteria",
  noNarrativeDataAvailable: "No detailed narrative data available for this assessment.",
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

  columnSpecies: "Espèces",
  columnCategory: "Catégorie",
  columnAssessDate: "Date d'éval.",
  columnTotalGbif: "GBIF total",
  columnNewGbif: "Nouveau GBIF",
  columnPctNewGbif: "% Nouveau GBIF",

  clearAll: "Tout effacer",
  speciesCount: "espèces",
  assessorFilter: "évaluateur",
  reviewerFilter: "réviseur",
  failedToLoadData: "Échec du chargement des données de la Liste rouge",

  redListAssessments: "Évaluations de la Liste rouge",
  compare: "Comparer",
  exitComparison: "Quitter la comparaison",
  viewOnIUCN: "Voir sur l'UICN",
  loadingAssessment: "Chargement de l'évaluation...",
  loadingComparison: "Chargement de l'évaluation de comparaison...",
  failedToLoadAssessment: "Échec du chargement des détails de l'évaluation.",
  retry: "Réessayer",
  noEarlierAssessment: "Aucune évaluation antérieure à comparer. C'est la première évaluation.",
  noNarrativeChanges: "Aucun changement dans le texte narratif entre ces évaluations.",
  statusImproved: "Statut amélioré",
  statusWorsened: "Statut aggravé",
  categoryChangedLabel: "Catégorie changée",
  categoryUnchanged: "Catégorie inchangée entre les évaluations",
  changedLabel: "modifié",
  notAvailable: "Non disponible",

  narrativeRationale: "Justification",
  narrativePopulation: "Population",
  narrativeHabitatEcology: "Habitat et écologie",
  narrativeThreats: "Menaces",
  narrativeConservationActions: "Actions de conservation",
  narrativeUseTrade: "Utilisation et commerce",
  narrativeGeographicRange: "Aire de répartition",

  assessedLabel: "Évalué",
  publishedLabel: "Publié",
  systemsLabel: "Systèmes",
  assessorsLabel: "Évaluateurs",
  reviewersLabel: "Réviseurs",
  habitatsLabel: "Habitats",
  threatClassificationLabel: "Classification des menaces",
  possiblyExtinct: "Peut-être éteinte",
  possiblyExtinctInTheWild: "Peut-être éteinte à l'état sauvage",
  trendLabel: "Tendance",
  criteriaLabel: "Critères",
  noNarrativeDataAvailable: "Aucune donnée narrative détaillée disponible pour cette évaluation.",
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

  columnSpecies: "Especies",
  columnCategory: "Categoría",
  columnAssessDate: "Fecha eval.",
  columnTotalGbif: "GBIF total",
  columnNewGbif: "Nuevo GBIF",
  columnPctNewGbif: "% Nuevo GBIF",

  clearAll: "Borrar todo",
  speciesCount: "especies",
  assessorFilter: "evaluador",
  reviewerFilter: "revisor",
  failedToLoadData: "Error al cargar los datos de la Lista Roja",

  redListAssessments: "Evaluaciones de la Lista Roja",
  compare: "Comparar",
  exitComparison: "Salir de comparación",
  viewOnIUCN: "Ver en la UICN",
  loadingAssessment: "Cargando evaluación...",
  loadingComparison: "Cargando evaluación de comparación...",
  failedToLoadAssessment: "Error al cargar los detalles de la evaluación.",
  retry: "Reintentar",
  noEarlierAssessment: "No hay evaluación anterior para comparar. Esta es la evaluación más antigua.",
  noNarrativeChanges: "No hay cambios en el texto narrativo entre estas evaluaciones.",
  statusImproved: "Estado mejorado",
  statusWorsened: "Estado empeorado",
  categoryChangedLabel: "Categoría cambiada",
  categoryUnchanged: "Categoría sin cambios entre evaluaciones",
  changedLabel: "cambiado",
  notAvailable: "No disponible",

  narrativeRationale: "Justificación",
  narrativePopulation: "Población",
  narrativeHabitatEcology: "Hábitat y ecología",
  narrativeThreats: "Amenazas",
  narrativeConservationActions: "Acciones de conservación",
  narrativeUseTrade: "Uso y comercio",
  narrativeGeographicRange: "Área de distribución",

  assessedLabel: "Evaluado",
  publishedLabel: "Publicado",
  systemsLabel: "Sistemas",
  assessorsLabel: "Evaluadores",
  reviewersLabel: "Revisores",
  habitatsLabel: "Hábitats",
  threatClassificationLabel: "Clasificación de amenazas",
  possiblyExtinct: "Posiblemente extinta",
  possiblyExtinctInTheWild: "Posiblemente extinta en estado silvestre",
  trendLabel: "Tendencia",
  criteriaLabel: "Criterios",
  noNarrativeDataAvailable: "No hay datos narrativos detallados disponibles para esta evaluación.",
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

  columnSpecies: "Espécies",
  columnCategory: "Categoria",
  columnAssessDate: "Data aval.",
  columnTotalGbif: "GBIF total",
  columnNewGbif: "Novo GBIF",
  columnPctNewGbif: "% Novo GBIF",

  clearAll: "Limpar tudo",
  speciesCount: "espécies",
  assessorFilter: "avaliador",
  reviewerFilter: "revisor",
  failedToLoadData: "Falha ao carregar os dados da Lista Vermelha",

  redListAssessments: "Avaliações da Lista Vermelha",
  compare: "Comparar",
  exitComparison: "Sair da comparação",
  viewOnIUCN: "Ver na UICN",
  loadingAssessment: "Carregando avaliação...",
  loadingComparison: "Carregando avaliação de comparação...",
  failedToLoadAssessment: "Falha ao carregar os detalhes da avaliação.",
  retry: "Tentar novamente",
  noEarlierAssessment: "Nenhuma avaliação anterior para comparar. Esta é a avaliação mais antiga.",
  noNarrativeChanges: "Nenhuma mudança no texto narrativo entre estas avaliações.",
  statusImproved: "Status melhorado",
  statusWorsened: "Status piorado",
  categoryChangedLabel: "Categoria alterada",
  categoryUnchanged: "Categoria inalterada entre avaliações",
  changedLabel: "alterado",
  notAvailable: "Não disponível",

  narrativeRationale: "Justificativa",
  narrativePopulation: "População",
  narrativeHabitatEcology: "Habitat e ecologia",
  narrativeThreats: "Ameaças",
  narrativeConservationActions: "Ações de conservação",
  narrativeUseTrade: "Uso e comércio",
  narrativeGeographicRange: "Área de distribuição",

  assessedLabel: "Avaliado",
  publishedLabel: "Publicado",
  systemsLabel: "Sistemas",
  assessorsLabel: "Avaliadores",
  reviewersLabel: "Revisores",
  habitatsLabel: "Habitats",
  threatClassificationLabel: "Classificação de ameaças",
  possiblyExtinct: "Possivelmente extinta",
  possiblyExtinctInTheWild: "Possivelmente extinta na natureza",
  trendLabel: "Tendência",
  criteriaLabel: "Critérios",
  noNarrativeDataAvailable: "Nenhum dado narrativo detalhado disponível para esta avaliação.",
};

export const staticTranslations: Record<string, Translations> = { en, fr, es, pt };

// Legacy export for compatibility
export const translations = staticTranslations;

// Legacy LOCALE_NAMES for compatibility (kept for any remaining usages)
export const LOCALE_NAMES: Record<string, string> = {
  en: "English",
  fr: "Français",
  es: "Español",
  pt: "Português",
};

// Helper to get static translations for a locale (returns null if not a static locale)
export function getStaticTranslations(locale: string): Translations | null {
  return staticTranslations[locale] || null;
}

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

export function getTranslatedTaxonName(locale: string, taxonId: string): string | null {
  const key = TAXON_NAME_KEYS[taxonId];
  if (!key) return null;
  const t = staticTranslations[locale] || staticTranslations["en"];
  return t[key] as string;
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

export function getTranslatedCategoryName(locale: string, code: string): string {
  const key = CATEGORY_NAME_KEYS[code];
  if (!key) return code;
  const t = staticTranslations[locale] || staticTranslations["en"];
  return t[key] as string;
}
