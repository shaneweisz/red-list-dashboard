/**
 * Build GBIF query parameters for a taxon config.
 *
 * Uses the most specific key available: classKey > classKeys > orderKeys > kingdomKey.
 * Shared by the trends API and country filters API.
 */

import type { TaxonConfig } from "@/config/taxa";

export function buildTaxonParams(taxon: TaxonConfig): URLSearchParams {
  const params = new URLSearchParams();

  if (taxon.gbifClassKey) {
    params.set("classKey", taxon.gbifClassKey.toString());
  } else if (taxon.gbifClassKeys && taxon.gbifClassKeys.length > 0) {
    taxon.gbifClassKeys.forEach((key) => {
      params.append("classKey", key.toString());
    });
  } else if (taxon.gbifOrderKeys && taxon.gbifOrderKeys.length > 0) {
    taxon.gbifOrderKeys.forEach((key) => {
      params.append("orderKey", key.toString());
    });
  } else if (taxon.gbifKingdomKey) {
    params.set("kingdomKey", taxon.gbifKingdomKey.toString());
  }

  return params;
}
