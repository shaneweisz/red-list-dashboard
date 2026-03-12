/**
 * Minimal CSV parser for reading per-taxon data files at runtime.
 */

import * as fs from "fs";

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current);
  return fields;
}

export function readCsv<T>(
  inputPath: string,
  parse: (row: Record<string, string>) => T
): T[] {
  const content = fs.readFileSync(inputPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const results: T[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = values[j] ?? "";
    }
    results.push(parse(row));
  }

  return results;
}
