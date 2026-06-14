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
- Within one filter, comma-separated values are OR; across filters they are AND.
- Threats match by prefix: threats=11 covers 11.1, 11.4, ... ("Climate change").
- Results cap at 200 rows; the total + a by-category breakdown are always shown.
- Every response has a "stats" object (assessed / outdated / outdated_pct, the %
  of assessments older than 10 years) — use it for percentage questions directly.

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
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CACHE_1H },
  });
}
