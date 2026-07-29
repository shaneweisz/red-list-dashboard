# Migrating the GBIF pipeline to Catalogue of Life

Design notes for moving off the frozen GBIF Backbone. Written before the code,
because a first attempt (#441) shipped silently wrong data and the reason was a
design assumption, not a bug.

## Why this is necessary

GBIF relaunched gbif.org on 18 June 2026 with the **Catalogue of Life Extended
Release** as its default taxonomy. The **GBIF Backbone** this pipeline was built
on was last updated in 2023 and will not be updated again.

The two use different key spaces — backbone keys are integers (`2434814`), CoL
keys are alphanumeric (`43MJ7`). A key from one resolves to nothing in the other,
and **GBIF answers that with an empty result set rather than an error**. That is
the single most important fact about this migration: every failure mode here is
silent. Nothing throws. Counts just become 0, or a species just disappears.

The immediate breakage (occurrence links returning 0 records) is already fixed in
#442 by naming the backbone checklist explicitly, and that will hold as long as
GBIF hosts the backbone. This migration is about the longer-term move.

## What the first attempt got wrong

#441 replaced GBIF API calls with local joins against the CoL archive we
download, on the stated basis that *"these keys are COL XR ids, and COL XR is
exactly what `data/species/` is built from."*

**That is false, and it is not a version-skew problem.** Verified:

- Our download is ChecklistBank release `315834` (COL26.7 XR, DOI `10.48580/dgykv`).
- GBIF's occurrence dataset reports **that same DOI** — so we had the right release.
- *Mantis religiosa* is `VFYZZ` in GBIF's index, and `VFYZZ` **404s** in that release.
- GBIF knows **both** `VFYZZ` ("Linné, 1758") and `3XWJS` ("Linnaeus, 1758") as
  accepted usages. The published export has only `3XWJS`. The occurrence facet
  emits `VFYZZ`.

GBIF's index contains usages the published CoL export does not. Any design that
resolves GBIF's occurrence keys against a local CoL copy will silently discard
them — measured at 99.5% of species for Mantodea, 9% for Coleoptera.

## Principles

### P1. GBIF is the sole authority for GBIF keys

Never substitute a local copy of CoL for GBIF's own answer about its own keys.
This holds in both directions: enumerate keys from GBIF's facets, and resolve
names through GBIF's match API.

This is not only about the missing usages. GBIF's matcher is simply better than
the local lookup #441 replaced it with — verified on the species #441 got wrong:

| name | local lookup (#441) | GBIF |
|---|---|---|
| *Pararge xiphia* | *Pararge aegeria*'s key (3.4M records) | `VL4BH` — correct species |
| *Filopaludina decipiens* | *Bithynia tentaculata*, a different family | `6J2V6` — correct species |
| *Pica nutalli* | no match (CoL spells it *nutallii*) | `V9XQK` — handles the spelling |

Cost: one request per species key. That is what the pre-migration pipeline did,
and it is affordable. Correctness is not the place to optimise.

### P2. Always pass classification context when matching names

`scientificName=Agelaius phoeniceus` alone returns **HIGHERRANK / Animalia** — a
species with 21M occurrence records, unmatched. Adding `kingdom=Animalia&class=Aves`
returns **EXACT, `5TQD6`**.

The Red List CSVs carry kingdom/class/order/family for every species. Pass them.
It resolves ambiguity and is harmless when there is none.

### P3. Never attribute one species' records to another

CoL synonymises taxa the Red List treats as separate species. When that happens,
inheriting the accepted taxon's occurrence counts puts a common species' data
under a threatened one — #441 did this to 102 CR/EN/VU species, e.g. *Pararge
xiphia* (NT, Madeira endemic) displaying 3,469,074 of *Pararge aegeria*'s records.

Wrong data is worse than missing data on a conservation dashboard.

So a synonym resolution is only followed when it is a **nomenclatural** change —
the same organism under a different name — not a **taxonomic** one:

| Red List name | CoL accepted | follow? | why |
|---|---|---|---|
| *Aquarana catesbeianus* | *Aquarana catesbeiana* | yes | same epithet, gender agreement |
| *Pica nutalli* | *Pica nutallii* | yes | orthographic variant (edit distance 1) |
| *Pieris segonzaci* | *Pieris napi* | **no** | different species |
| *Sus bucculentus* | *Sus scrofa* | **no** | different species |
| *Cottus jaxartensis* | *Cottus gobio* | **no** | different species |

Rule: follow when the specific epithet is identical or within a small edit
distance; otherwise record the link with a distinct match type and attribute **no
counts**. The species shows no GBIF data rather than someone else's.

This also removes the need for #441's "claim tier" machinery, which only helped
when the accepted name belonged to another *assessed* species — the rarer case.

### P4. Coverage must be derived and asserted, not hand-ported

#441 carried the backbone's per-rank key lists across 1:1. Two failure modes
followed, and neither raised anything:

- **Gaps.** CoL splits the backbone's Perciformes into orders that did not exist
  before (*Trachurus murphyi* is Carangiformes now), and raises octocorals to a
  class outside Anthozoa. Fishes lost 4,879 species; corals lost 44.9% of their
  occurrences, including *Paragorgia arborea* (NT) losing 2.36M records.
- **Overlaps.** Gnetidae sits *inside* Pinopsida in CoL, so listing both
  double-counted: 43 species ended up with more records since assessment than in
  total, which is impossible.

So the group key lists get two assertions at build time:

1. Every class/order the Red List assigns to a group is reachable from that
   group's keys. Catches the coral gap.
2. No key in a group is an ancestor of another. Catches the Gnetidae overlap.

### P5. Nothing silent

Every count that can silently become zero gets a guard:

- Unresolved facet keys are counted and reported per taxon; above a threshold the
  sync fails rather than writing a truncated file.
- A sync phase diffs per-group species counts and occurrence totals against the
  previous sync and reports every material regression. Doing this by hand caught
  fishes and missed corals, Mantodea and Phasmida.
- `checklistKey` is named on every request, so no result ever depends on which
  default GBIF is serving that week.

## Staging

Each stage is independently reviewable and independently revertable.

- **A** — shared GBIF module; `checklistKey` on every call. No key-space change.
- **B** — derive group keys from the taxonomy; add the two coverage assertions.
- **C** — name matching through GBIF with classification context and the P3 policy.
- **D** — facet key resolution through GBIF, with caching.
- **E** — drop-rate guards; regression-diff phase; one species one key in `build-parquet`.
- **F** — sync, verify against every species the review named, open the PR.

## What P3 costs, measured

Blanking a lumped species is not free, and the size of the bill is worth stating.

Under the backbone, *Pararge xiphioides* — a Canary Islands endemic — displayed
**3,428,847** occurrence records. Its own key holds **4,738**. The rest belonged
to *Pararge aegeria*, a widespread European butterfly CoL treats it as a synonym
of. So the pre-migration number was already wrong, by three orders of magnitude,
and blanking it removes far more error than information.

But 4,738 records *were* its own, and blanking loses them too. Sampled across
lumped species the residue is small — 6 records for *Hipparchia neapolitana*, 24
for *Pieris segonzaci*, 1 for *Cottus jaxartensis*, 0 for *Sus bucculentus* —
because GBIF attributes most records to the accepted taxon.

Recovering it is possible: the synonym's own key carries exactly those records.
It is not done here because the counts come from the facet enumeration, which
emits accepted keys, so a synonym key would need a separate query per lumped
species. Worth doing if the residue ever looks larger than it does now.
