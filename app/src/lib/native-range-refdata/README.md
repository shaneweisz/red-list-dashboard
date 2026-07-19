# Native-range reference data

## `wcvp-native-countries.json` (~941k names, full WCVP checklist)

Native-country lookup (ISO 3166-1 alpha-2 codes) for the "POWO" native-range source in `OccurrenceMapRow.tsx` (issue #82), alongside the Red List assessment-location-based source (`s.countries`, computed in `scripts/fetch-redlist-species.ts`).

Built by `scripts/fetch-wcvp-native-range.ts` from two independent, redistributable sources:

- **Kew's World Checklist of Vascular Plants (WCVP)**, `wcvp_names.csv` + `wcvp_distribution.csv` — **CC BY 3.0** (`http://creativecommons.org/licenses/by/3.0`, confirmed directly from the bundled `README_WCVP.xlsx`; cite as [Govaerts et al. 2021, *Sci Data* 8:215](https://doi.org/10.1038/s41597-021-00997-6)), downloaded from `https://sftp.kew.org/pub/data-repositories/WCVP/wcvp.zip`. CC BY permits redistributing derived/filtered subsets like this one for any purpose provided attribution is kept — this file (both the changes made and the citation above) is that attribution. Only `introduced=0 AND extinct=0 AND location_doubtful != 1` distribution rows count as "native". Covers the FULL checklist, keyed by every species-rank name (Accepted or Synonym, ~1.05M candidate names) resolved through `accepted_plant_name_id` — not scoped to our own Red List species, since this dashboard also shows a GBIF occurrence map for Not-Evaluated (NE) species outside assessed.parquet entirely. A name genuinely absent from WCVP, or spelled differently, just gets no POWO entry, and the UI falls back to the Red List source where available.
- **TDWG WGSRPD level-3 → ISO country crosswalk**: the original Brummitt Ed.2 table (`tdwg/wgsrpd` GitHub repo, `109-488-1-ED/2nd Edition/tblLevel3.txt`), not rWCVP's own `wgsrpd_mapping` (Gallagher et al. 2020) — that one only exists as an R `.rda` binary with no plain-text source in the package repo, so it isn't reusable outside R. 353/369 L3 codes resolve to a country after applying `WGSRPD_OVERRIDES` in the fetch script for confident single- or unambiguous-multi-country gaps in the official table (e.g. `FRA`→France, `RUS`→Russia — cross-checked that other Russian L3 subdivisions do have an ISO code, so this looks like a data-entry gap, not an intentional omission). The overrides also **correct 4 codes the table fills with a non-current ISO value** that would silently never match GBIF's own `countryCode` field: `GRB` (Great Britain) is listed as `UK` (real code `GB`), and 3 codes use a pre-1990s dissolved state the table was never updated after it split — `CZE` as `CS` (Czechoslovakia → Czechia+Slovakia), `YUG` as `YU` (Yugoslavia → its 6 successor states), `NLA` as `AN` (Netherlands Antilles → its 3 successor territories). Genuine multi-country composites with no clean split (Leeward Is., Gulf States, New Guinea, Borneo, ...) are left unmapped — species whose only native L3 areas are unmapped composites simply won't show every country they're native to, degrading gracefully rather than guessing.

**Real example found while building this**: *Acorus calamus* — WCVP's accepted concept of this name is native **only to Kazakhstan** (`geographic_area` note: "C. Asia (Irtysh River valley)"); every other distribution row for it (all of Europe, North America, East/South Asia) is flagged `introduced=1`. The Red List assessment's own country list for the same name has 26 countries across Asia, Russia, and North America. This is a genuine taxonomic-concept disagreement between the two sources (not a bug in either), not just Red List data being "less precise" — exactly the kind of case issue #82 asked for a choice between sources to handle.

Regenerate with:

```
npx tsx scripts/fetch-wcvp-native-range.ts
```

(WCVP ships periodic updates; re-run occasionally, not part of the regular weekly sync.)
