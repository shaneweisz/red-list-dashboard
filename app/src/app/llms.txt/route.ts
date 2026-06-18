/**
 * /llms.txt — a short, machine-readable guide so an agent can answer questions
 * from the dashboard via /browse. Generated from filter-vocab so it can't drift
 * from what /browse actually accepts. The base URL is taken from the request
 * origin, so pasted example links always point at this same deployment.
 */

import { NextRequest, NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";
import {
  THREAT_CATEGORIES, FEATURED_TAXA, ALL_CATEGORIES,
  SYSTEMS, POPULATION_TRENDS, taxonLabel, categoryLabel,
} from "@/lib/filter-vocab";
import { IUCN_REGION_ORDER } from "@/lib/regions";

export const revalidate = 3600;

export function GET(req: NextRequest) {
  const base = new URL(req.url).origin;
  const taxa = FEATURED_TAXA.map((id) => `  - ${id} (${taxonLabel(id)})`).join("\n");
  const threats = THREAT_CATEGORIES.map((t) => `  - ${t.code} = ${t.label}`).join("\n");
  const cats = ALL_CATEGORIES.map((c) => `  - ${c} = ${categoryLabel(c)}`).join("\n");

  const body = `# Red List Dashboard

> IUCN Red List assessments linked to GBIF occurrences and the Catalogue of Life
> tree of life. The main site is a browser app (empty HTML to a fetcher). To read
> data or answer questions, use /browse below — it returns server-rendered HTML,
> or JSON with &format=json.

## Two ways to query

1. Browse a taxon:   ${base}/browse?taxa=<name>[&filters]
2. Look up a species: ${base}/browse?search=<name>

\`taxa\` works at ANY taxonomic rank — a curated group (birds, corals), a
sub-group (sharks-rays, flatworms), or a scientific name for a class/order/family
(felidae, odonata, carnivora). \`search\` matches scientific OR common names,
including synonyms / old names (they resolve to the accepted species).

## Rules
- Browsing needs one \`taxa\` value; looking up a species needs \`search\`.
- **Prefer \`&format=json\`** — it's the machine-readable response; the HTML view is
  for humans. The JSON always includes the query you sent (\`query\`) and an
  \`interpreted\` list, so you can confirm the result matches your request.
- The first request after a quiet period may take a few seconds (cold start). If a
  request times out, retry once. A genuine failure returns a **non-200 status with an
  \`error\` field — never another species' data**, so trust the status code.
- Within one filter, comma-separated values are OR; across filters they are AND.
- Threats match by prefix: threats=11 covers 11.1, 11.4, ... ("Climate change").
- Results cap at 200 rows; the total + a by-category breakdown are always shown.
- Every response has a "stats" object (assessed / outdated / outdated_pct, the %
  of assessments older than 10 years) — use it for percentage questions directly.
- Every response includes a "dashboard_url" — the interactive dashboard pre-filtered
  to this same query (a REPRODUCE-MY-VIEW link, not a primary-source citation). Show
  it to the user and encourage them to open it to inspect and verify the data.
- Each species also carries canonical primary-source ids (sis_taxon_id, assessment_id,
  gbif_species_key, col_id) — cite the IUCN page https://www.iucnredlist.org/species/<sis>/<assessment_id>,
  GBIF https://www.gbif.org/species/<gbif_species_key>, or CoL for individual claims.
  "red_list_version" pins the release the assessments were synced from.
- Add &groupBy=threat (or category, trend, system, endemism, country) for server-side
  counts over the FULL matched set — far cheaper and more reliable than eyeballing rows.
  Returns a "groups" object. Combine several: &groupBy=threat&groupBy=trend.
- A "coverage" block reports how many species in the queried group are Not Evaluated
  globally — use it so you don't understate a crisis by trusting the assessed figure.
- A "taxon_notes" array warns when a colloquial taxon silently narrowed (e.g. plants →
  flowering plants only, excluding gymnosperms/ferns/mosses/algae).

## Parameters (values may be codes OR plain-English names)

taxa — any rank; featured groups:
${taxa}

threats — IUCN threat class (sub-codes like 11.4 work; aliases: climate-change,
pollution, invasive-species, overfishing, logging, hunting, dams):
${threats}

categories — IUCN status (aliases: threatened = CR,EN,VU; extinct = EX,EW):
${cats}

systems: ${SYSTEMS.join(", ")}
trends:  ${POPULATION_TRENDS.join(", ")}
hasMap:  yes | no
countries: ISO alpha-2 code or name (e.g. IN or India)
region (IUCN region — expands to its countries): ${IUCN_REGION_ORDER.join(", ")}
assessors / reviewers: name of the latest-assessment assessor/reviewer (substring, e.g. assessors=Smith)
search:  scientific or common name (incl. synonyms)
outdated: yes | no  (assessment more than 10 years old)
minObs / maxObs: GBIF occurrence-count bounds
minAssessmentYear / maxAssessmentYear: assessment-year bounds
minDescribedYear / maxDescribedYear: year-described bounds (NE species)
groupBy: category | threat | trend | system | endemism | country (server-side counts over the full match)

## Examples
- ${base}/browse?taxa=corals&threats=climate-change
    Coral species threatened by climate change
- ${base}/browse?taxa=mammals
    All mammals — read stats.outdated_pct for % of outdated assessments
- ${base}/browse?taxa=felidae&categories=threatened
    Threatened cats (arbitrary rank: a family name)
- ${base}/browse?taxa=amphibians&region=Sub-Saharan+Africa&categories=threatened
    Threatened amphibians in a region (IUCN region expands to its countries)
- ${base}/browse?search=tiger
    Look up a species by name
- ${base}/browse?search=Felis+jubata
    Look up by an old name — resolves to the accepted species (Acinonyx jubatus)
`;

  return new NextResponse(body, {
    // Unlisted: keep it out of crawler indexes; it's meant to be fetched only when
    // a user points an agent at this URL, not auto-discovered.
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CACHE_1H, "X-Robots-Tag": "noindex, nofollow" },
  });
}
