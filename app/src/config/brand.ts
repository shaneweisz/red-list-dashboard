export type Brand = {
  title: string;
  /** On-page heading. Falls back to `title` when omitted. */
  pageTitle?: string;
  description: string;
};

const DEFAULT_BRAND: Brand = {
  title: "IUCN Red List Assessments Dashboard",
  description: "IUCN Red List and GBIF occurrence data explorer",
};

// Per-hostname overrides. Keys are bare hostnames (no port, no "www.").
const BRANDS: Record<string, Brand> = {
  "dashoflife.org": {
    title: "Dashboard of Life",
    pageTitle: "A Dashboard of Life on Earth",
    description: "IUCN Red List and GBIF occurrence data explorer",
  },
};

/** Resolve the brand for an incoming request's `Host` header. */
export function brandForHost(host: string | null | undefined): Brand {
  if (!host) return DEFAULT_BRAND;
  const hostname = host.split(":")[0].toLowerCase().replace(/^www\./, "");
  return BRANDS[hostname] ?? DEFAULT_BRAND;
}
