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

// "Dash for Life" is the default brand shown on every host.
const DEFAULT_BRAND: Brand = {
  title: "Dash for Life",
  subtitle: "A Dashboard for Conservation of Threatened Species",
  tabTitle: "Dash for Life",
  description: "A dashboard for biodiversity data about life on Earth",
  assessedTabLabel: "Red List Assessed",
  unassessedTabLabel: "Unassessed",
  showGlobe: true,
};

// Earlier brand variants — not the default for now, kept defined and exported
// (not mapped to any hostname below) in case they're revisited later.
export const RED_LIST_BRAND: Brand = {
  title: "Red List Dashboard",
  subtitle: "A Dashboard for Conservation of Threatened Species",
  description: "A dashboard for biodiversity data about life on Earth",
  showGlobe: true,
};

export const DASH_OF_LIFE_BRAND: Brand = {
  ...DEFAULT_BRAND,
  title: "Dash of Life",
  tabTitle: "Dash of Life",
};

// Per-hostname overrides. Keys are bare hostnames (no port, no "www.").
const BRANDS: Record<string, Brand> = {};

/** Resolve the brand for an incoming request's `Host` header. */
export function brandForHost(host: string | null | undefined): Brand {
  if (!host) return DEFAULT_BRAND;
  const hostname = host.split(":")[0].toLowerCase().replace(/^www\./, "");
  return BRANDS[hostname] ?? DEFAULT_BRAND;
}
