import { ALPHA2_TO_NAME } from "./WorldMap";
export { fmtQty } from "@/lib/data-utils";

export function countryName(code: string): string {
  return ALPHA2_TO_NAME[code] || code;
}
