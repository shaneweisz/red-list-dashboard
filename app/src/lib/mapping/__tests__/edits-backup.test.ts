import { describe, it, expect } from "vitest";
import {
  backupFileName,
  buildEditsBackup,
  readEditsBackup,
  summariseBackup,
  EDITS_BACKUP_VERSION,
} from "../edits-backup";

const georeference = {
  gbifID: 1,
  decimalLatitude: 4.55,
  decimalLongitude: -75.5,
  coordinateUncertaintyInMeters: 5000,
  georeferencedDate: "2026-08-27T00:00:00.000Z",
};

const backup = () =>
  buildEditsBackup({
    speciesKey: "6CX6F",
    scientificName: "Dioscorea biplicata",
    savedAt: "2026-08-27T09:30:00.000Z",
    georeferences: { 1: georeference },
    exclusions: {
      2: { gbifID: 2, justification: "Cultivated", excludedAt: "2026-08-27T09:00:00.000Z" },
    },
    dates: { 3: { gbifID: 3, eventDate: "1974", addedAt: "2026-08-27T09:10:00.000Z" } },
    pointFile: null,
  });

describe("the saved-work file", () => {
  it("round-trips everything the browser was holding", () => {
    const read = readEditsBackup(JSON.stringify(backup()), "6CX6F");
    expect("backup" in read).toBe(true);
    if (!("backup" in read)) return;
    expect(read.backup.georeferences[1]).toEqual(georeference);
    expect(read.backup.exclusions[2].justification).toBe("Cultivated");
    expect(read.backup.dates[3].eventDate).toBe("1974");
    expect(read.backup.version).toBe(EDITS_BACKUP_VERSION);
  });

  it("refuses another species' work, which would be a quiet disaster", () => {
    const read = readEditsBackup(JSON.stringify(backup()), "ANOTHER");
    expect(read).toEqual({ error: expect.stringContaining("Dioscorea biplicata") });
  });

  it("refuses a file from a newer dashboard than this one", () => {
    const future = { ...backup(), version: EDITS_BACKUP_VERSION + 1 };
    expect(readEditsBackup(JSON.stringify(future), "6CX6F")).toEqual({
      error: expect.stringContaining("newer version"),
    });
  });

  it("refuses a file that isn't ours, and one that isn't JSON", () => {
    expect(readEditsBackup(JSON.stringify({ hello: "world" }), "6CX6F")).toEqual({
      error: expect.stringContaining("isn't a saved-work file"),
    });
    expect(readEditsBackup("not json at all", "6CX6F")).toEqual({
      error: expect.stringContaining("isn't JSON"),
    });
  });

  it("survives a file with a store missing rather than restoring undefined", () => {
    const partial = { ...backup(), dates: undefined } as unknown as Record<string, unknown>;
    const read = readEditsBackup(JSON.stringify(partial), "6CX6F");
    expect("backup" in read && read.backup.dates).toEqual({});
  });

  it("says what it holds, in the plural only when it should", () => {
    expect(summariseBackup(backup())).toBe("1 georeference, 1 exclusion, 1 date");
    const many = { ...backup(), dates: {} };
    expect(summariseBackup(many)).toContain("0 dates");
  });

  it("counts an imported point file among the work", () => {
    const withFile = {
      ...backup(),
      pointFile: { fileName: "f.csv", importedAt: "", points: [{}, {}], errors: [], extraColumns: [] },
    } as ReturnType<typeof backup>;
    expect(summariseBackup(withFile)).toContain("2 imported points");
  });

  it("names the file after the species and the day", () => {
    expect(backupFileName("Dioscorea biplicata", "2026-08-27T09:30:00.000Z")).toBe(
      "dioscorea_biplicata_dashboard_work_2026-08-27.json"
    );
  });
});
