export type Brand = {
  title: string;
  description: string;
  /** Show the globe icon before the title (used by the Dash of Life brand). */
  showGlobe?: boolean;
};

const DEFAULT_BRAND: Brand = {
  title: "IUCN Red List Assessments Dashboard",
  description: "A dashboard for biodiversity data about life on Earth",
};

// Per-hostname overrides. Keys are bare hostnames (no port, no "www.").
const BRANDS: Record<string, Brand> = {
  "dashoflife.org": {
    title: "Dash of Life: A Dashboard of Life on Earth",
    description: "A dashboard for biodiversity data about life on Earth",
    showGlobe: true,
  },
};

/** Resolve the brand for an incoming request's `Host` header. */
export function brandForHost(host: string | null | undefined): Brand {
  if (!host) return DEFAULT_BRAND;
  const hostname = host.split(":")[0].toLowerCase().replace(/^www\./, "");
  return BRANDS[hostname] ?? DEFAULT_BRAND;
}
