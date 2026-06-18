import { describe, it, expect } from "vitest";
import { primarySources, RED_LIST_VERSION } from "../source-links";

describe("primarySources", () => {
  it("builds canonical IUCN / GBIF / CoL links from the identifiers", () => {
    const p = primarySources({ sis_taxon_id: 15955, assessment_id: 123456, gbif_species_key: 5219404, col_id: "62CKM" });
    expect(p.iucn_url).toBe("https://www.iucnredlist.org/species/15955/123456");
    expect(p.gbif_url).toBe("https://www.gbif.org/species/5219404");
    expect(p.col_url).toBe("https://www.catalogueoflife.org/data/taxon/62CKM");
    expect(p.red_list_version).toBe(RED_LIST_VERSION);
  });

  it("omits the IUCN link when the assessment id is missing (e.g. Not-Evaluated)", () => {
    const p = primarySources({ sis_taxon_id: null, assessment_id: null, gbif_species_key: 42, col_id: "ABC" });
    expect(p.iucn_url).toBeNull();
    expect(p.gbif_url).toBe("https://www.gbif.org/species/42");
    expect(p.col_url).toBe("https://www.catalogueoflife.org/data/taxon/ABC");
  });

  it("returns all-null links when no identifiers are present", () => {
    const p = primarySources({});
    expect(p).toMatchObject({ iucn_url: null, gbif_url: null, col_url: null, sis_taxon_id: null });
  });
});
