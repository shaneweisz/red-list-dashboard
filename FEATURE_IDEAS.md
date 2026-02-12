# Feature Ideas — High Value, Low Complexity

Brainstormed features for the Red List Dashboard, prioritized by
usefulness-to-effort ratio. All leverage existing data and architecture.

---

## 1. CSV Export of Filtered Species List

Export the current filtered species table as a CSV file. All data is already
assembled by the `/api/redlist/species` endpoint — just needs serialization and
a download button.

**Why it matters:** Researchers want to pull data into their own tools (Excel,
R, Python) for further analysis. This is the single most-requested feature in
data dashboards.

**Scope:** One button component + a client-side CSV builder. No new API work.

---

## 2. Shareable Filter State via URL Parameters

Sync filter state (taxon, category, years-since-assessment, search term) to URL
query parameters so views survive page reloads and can be shared via link.

Example: `?taxon=mammalia&category=DD,CR&years=10-20&search=elephant`

**Why it matters:** Lets researchers share a specific filtered view with
colleagues or bookmark it for later.

**Scope:** Replace `useState` with a URL-synced state hook (e.g., `useSearchParams`).
No API changes.

---

## 3. Reassessment Priority Score

Compute a composite score per species from existing signals:

| Signal                           | Weight |
|----------------------------------|--------|
| Years since last assessment      | High   |
| New GBIF records since assessment| Medium |
| Data Deficient status            | High   |
| Population trend = Decreasing    | Medium |
| Category change in history       | Low    |

Display as a sortable column. Turns the dashboard from exploration tool into
an actionable triage list.

**Why it matters:** The core value proposition of the dashboard is prioritizing
reassessments. A single score makes this concrete.

**Scope:** Client-side computed column. All input data is already loaded.

---

## 4. Quick Filter Presets

One-click buttons that apply predefined filter combinations:

- **"Needs reassessment"** — DD + last assessed ≥10 years ago
- **"New evidence available"** — species with >50 new GBIF records since assessment
- **"Possibly extinct"** — `possibly_extinct = true` (field exists in assessment details)
- **"Declining"** — `population_trend = Decreasing`

**Why it matters:** Reduces cognitive load. New users immediately see what the
dashboard can surface without learning the filter system.

**Scope:** Button bar that sets existing filter state. No new data fetching.

---

## 5. Column Sorting on Species Table

Click column headers to sort by: scientific name, category (severity order),
years since assessment, new GBIF records count.

**Why it matters:** Finding outliers (most overdue, most new evidence) currently
requires manually scanning rows.

**Scope:** Client-side sort on already-loaded array. One state variable
(`sortColumn`, `sortDirection`) + a comparator.

---

## 6. Category Change Indicators

Show visual indicators when a species has changed IUCN category over time:

- ▲ Red arrow: category worsened (e.g., LC → VU)
- ▼ Green arrow: category improved (e.g., EN → VU)
- — Gray dash: no change

Data source: `previous_assessments` array, already loaded per species.

**Why it matters:** Category changes are a key signal for conservation action.
Currently hidden behind expanding each row.

**Scope:** Conditional icon in species table row. Pure rendering logic.

---

## 7. Population Trend Icons in Species Table

Add a column with trend icons:

- ↑ Increasing (green)
- ↓ Decreasing (red)
- → Stable (gray)
- ? Unknown (light gray)

Data source: `population_trend` field, already in species data.

**Why it matters:** Population trend is one of the most important conservation
signals but isn't visible in the main table.

**Scope:** One small column with conditional icon. Trivial.

---

## 8. Taxon-Level Summary Stats Banner

When a taxon is selected, show a compact stats row:

- Total species assessed
- % Data Deficient
- % Threatened (CR + EN + VU)
- Median years since last assessment
- Total new GBIF records across all species

**Why it matters:** Provides immediate context about a taxonomic group before
drilling into individual species.

**Scope:** Aggregate from existing `/api/redlist/stats` and
`/api/redlist/assessments` data. One presentational component.

---

## 9. Bookmark/Flag Species for Review

Star/flag icon per species row, persisted in `localStorage`. Add a "Show
flagged only" toggle to the filter bar.

**Why it matters:** Researchers work through the list over multiple sessions
and need to track which species they've identified for follow-up.

**Scope:** `localStorage` read/write + toggle state. No backend.

---

## 10. Keyboard Navigation

- ↑/↓ arrows: navigate species table rows
- Enter: expand/collapse selected row
- Escape: collapse expanded row
- `/`: focus search input

**Why it matters:** Power users navigating hundreds of species benefit
significantly from keyboard-driven workflows.

**Scope:** `onKeyDown` handler on the table container + focus management.

---

## Implementation Priority Recommendation

If picking a handful to start with, these three deliver the most value
for the least effort:

1. **Column sorting** (#5) — immediate usability win, ~30 lines of code
2. **Population trend icons** (#7) — data is already there, just needs rendering
3. **CSV export** (#1) — most universally requested feature in data tools
4. **URL filter state** (#2) — makes the tool shareable, a multiplier on all other features
