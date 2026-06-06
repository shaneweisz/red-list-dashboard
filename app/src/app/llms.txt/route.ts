/**
 * /llms.txt — concise, machine-readable guide so an LLM can answer questions
 * from the dashboard's base filters via /browse. Generated from filter-vocab so
 * it can never drift from what /browse actually accepts.
 */

import { NextResponse } from "next/server";
import { CACHE_1H } from "@/lib/cache-headers";
import {
  THREAT_CATEGORIES, FEATURED_TAXA, ALL_CATEGORIES,
  SYSTEMS, POPULATION_TRENDS, taxonLabel, categoryLabel,
} from "@/lib/filter-vocab";

export const revalidate = 3600;

export function GET() {
  const taxa = FEATURED_TAXA.map((id) => `  - ${id} (${taxonLabel(id)})`).join("\n");
  const threats = THREAT_CATEGORIES.map((t) => `  - ${t.code} = ${t.label}`).join("\n");
  const cats = ALL_CATEGORIES.map((c) => `  - ${categoryLabel(c)}`).join("\n");

  const body = `# Red List Dashboard

> Explore IUCN Red List assessments (linked to GBIF occurrence data) for ~280,000
> species across 21 taxonomic groups. The main site (red.cst.cam.ac.uk) is an
> interactive app that renders in the browser. To read data programmatically or
> answer questions, use the /browse endpoint below, which returns server-rendered
> HTML (or JSON).

## Querying /browse

Base: https://red.cst.cam.ac.uk/browse
Combine query parameters; comma-separate multiple values. Values may be codes OR
plain-English names (e.g. threats=climate-change, categories=endangered,
taxa=birds, countries=Brazil). Add &format=json for a JSON response.

Rules:
- Pick at least one \`taxa\` value (or a \`search\` term). Cross-taxa listings are
  not supported in one call — query each taxon and combine.
- Within one filter, multiple values are OR; across filters they are AND.
- Threats match by prefix: threats=11 covers 11.1, 11.4, ... ("Climate change").
- Results are capped at 200 rows; the total count is always shown.
- Every response includes a "stats" object (and an HTML line): assessed count,
  outdated count, and outdated_pct — the % of assessments older than 10 years.
  Use it for percentage questions; no need to list species.

## Parameters

taxa (taxonomic group):
${taxa}
  (subgroups also work, e.g. sharks-rays, beetles)

threats (IUCN threat class; sub-codes like 11.4 work too):
${threats}
  aliases: climate-change, pollution, invasive-species, overfishing, logging, hunting, dams ...

categories (IUCN Red List status):
${cats}
  aliases: threatened (= CR, EN, VU), extinct (= EX, EW)

systems: ${SYSTEMS.join(", ")}
trends:  ${POPULATION_TRENDS.join(", ")}
hasMap:  yes | no
countries: ISO alpha-2 code or country name (e.g. IN or India)
search:  free-text scientific or common name
outdated: yes | no  (assessment more than 10 years old)
minObs / maxObs: GBIF occurrence-count bounds (e.g. minObs=100)
minAssessmentYear / maxAssessmentYear: assessment-year bounds (e.g. minAssessmentYear=2015)

## Examples

- https://red.cst.cam.ac.uk/browse?taxa=corals&threats=climate-change
    Which coral species are threatened by climate change
- https://red.cst.cam.ac.uk/browse?taxa=mammalia
    What % of mammal assessments are outdated → read stats.outdated_pct
- https://red.cst.cam.ac.uk/browse?taxa=insecta&categories=DD&minObs=100&outdated=yes&countries=India
    Data-deficient insects in India with >100 GBIF records, assessed over 10 years ago
- https://red.cst.cam.ac.uk/browse?taxa=mammalia&categories=critically-endangered&trends=Decreasing
    Critically endangered mammals with declining populations
- https://red.cst.cam.ac.uk/browse?search=tiger
    Look up a species by name
`;

  return new NextResponse(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", ...CACHE_1H },
  });
}
