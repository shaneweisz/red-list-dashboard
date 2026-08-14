"use client";

import dynamic from "next/dynamic";

const OccurrenceMapRow = dynamic(() => import("@/components/OccurrenceMapRow"), { ssr: false });

/**
 * Client half of the standalone occurrence page. The species is resolved on
 * the server (see page.tsx) so there's no round trip before the map appears —
 * this only exists because the map itself can't be server-rendered.
 */
export default function OccurrencePanel(props: {
  speciesKey: string;
  scientificName: string;
  taxonGroup: string;
  category: string;
  criteria: string | null;
  assessmentId: number | null;
  assessmentDate: string | null;
  sisTaxonId: number | null;
  nativeCountriesRedList?: string[];
  dashboardTaxonToken?: string | null;
  dashboardSpeciesKey?: string | null;
}) {
  return (
    <OccurrenceMapRow
      speciesKey={props.speciesKey}
      mounted
      fullscreen
      assessmentYear={props.assessmentDate ? new Date(props.assessmentDate).getFullYear() : null}
      assessmentDate={props.assessmentDate}
      assessmentId={props.assessmentId}
      sisTaxonId={props.sisTaxonId}
      category={props.category}
      criteria={props.criteria}
      taxonGroup={props.taxonGroup}
      scientificName={props.scientificName}
      nativeCountriesRedList={props.nativeCountriesRedList}
      dashboardTaxonToken={props.dashboardTaxonToken}
      dashboardSpeciesKey={props.dashboardSpeciesKey}
    />
  );
}
