import { ALPHA2_TO_NAME } from "./WorldMap";

export function countryName(code: string): string {
  return ALPHA2_TO_NAME[code] || code;
}

export function fmtQty(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return n.toLocaleString();
}
