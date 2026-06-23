export type Brand = {
  title: string;
  /** Tagline shown beneath the title; omitted brands render no subtitle. */
  subtitle?: string;
  description: string;
  /** Browser-tab title; falls back to `title` when omitted. */
  tabTitle?: string;
  /** Label for the "reassessments" view-mode tab; defaults to "Reassessments". */
  assessedTabLabel?: string;
  /** Label for the "new-assessments" view-mode tab; defaults to "New Assessments". */
  unassessedTabLabel?: string;
  /** Show the globe icon before the title (used by the Dash of Life brand). */
  showGlobe?: boolean;
};

// "Dash of Life" is the default brand shown on every host.
const DEFAULT_BRAND: Brand = {
  title: "Dash of Life",
  subtitle: "A Dashboard for Threatened Species Conservation",
  tabTitle: "Dash of Life",
  description: "A dashboard for biodiversity data about life on Earth",
  assessedTabLabel: "Red List Assessed",
  unassessedTabLabel: "Unassessed",
  showGlobe: true,
};

// The original IUCN Red List dashboard branding, kept only for the
// dedicated Red List hostnames below.
const RED_LIST_BRAND: Brand = {
  title: "IUCN Red List Assessments Dashboard",
  description: "A dashboard for biodiversity data about life on Earth",
};

// Per-hostname overrides. Keys are bare hostnames (no port, no "www.").
const BRANDS: Record<string, Brand> = {
  "red.cst.cam.ac.uk": RED_LIST_BRAND,
  "red-list-dashboard.vercel.app": RED_LIST_BRAND,
};

/** Resolve the brand for an incoming request's `Host` header. */
export function brandForHost(host: string | null | undefined): Brand {
  if (!host) return DEFAULT_BRAND;
  const hostname = host.split(":")[0].toLowerCase().replace(/^www\./, "");
  return BRANDS[hostname] ?? DEFAULT_BRAND;
}
