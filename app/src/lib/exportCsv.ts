import { type RedListSpecies } from "@/hooks/useRedListSpeciesQuery";

const CSV_COLUMNS: { header: string; getValue: (s: RedListSpecies) => string }[] = [
  { header: "Scientific Name", getValue: (s) => s.scientific_name },
  { header: "Common Name", getValue: (s) => s.common_name ?? "" },
  { header: "Category", getValue: (s) => s.category },
  { header: "Family", getValue: (s) => s.family ?? "" },
  { header: "Order", getValue: (s) => s.order_name ?? "" },
  { header: "Class", getValue: (s) => s.class_name ?? "" },
  { header: "Assessment Date", getValue: (s) => s.assessment_date ?? "" },
  { header: "Year Published", getValue: (s) => s.year_published ?? "" },
  { header: "Population Trend", getValue: (s) => s.population_trend ?? "" },
  { header: "Countries", getValue: (s) => s.countries.join("; ") },
  { header: "GBIF Occurrence Count", getValue: (s) => s.gbif_occurrence_count?.toString() ?? "" },
  { header: "GBIF Observations After Assessment Year", getValue: (s) => s.gbif_observations_after_assessment_year?.toString() ?? "" },
  { header: "SIS Taxon ID", getValue: (s) => s.sis_taxon_id?.toString() ?? "" },
  { header: "Assessment ID", getValue: (s) => s.assessment_id?.toString() ?? "" },
  { header: "GBIF Species Key", getValue: (s) => s.gbif_species_key?.toString() ?? "" },
  { header: "Systems", getValue: (s) => s.systems.join("; ") },
  { header: "Growth Forms", getValue: (s) => s.growth_forms.join("; ") },
  { header: "Movement Pattern", getValue: (s) => s.movement_pattern ?? "" },
  { header: "Possibly Extinct", getValue: (s) => s.possibly_extinct ? "Yes" : "" },
  { header: "Possibly Extinct in Wild", getValue: (s) => s.possibly_extinct_in_the_wild ? "Yes" : "" },
  { header: "Criteria", getValue: (s) => s.criteria ?? "" },
  { header: "Threat Codes", getValue: (s) => s.threat_codes.join("; ") },
];

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function speciesToCsv(species: RedListSpecies[]): string {
  const header = CSV_COLUMNS.map((c) => c.header).join(",");
  const rows = species.map((s) =>
    CSV_COLUMNS.map((c) => escapeCsvField(c.getValue(s))).join(",")
  );
  return [header, ...rows].join("\n");
}

export function downloadSpeciesCsv(species: RedListSpecies[], filename = "species-export.csv") {
  const csv = speciesToCsv(species);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
