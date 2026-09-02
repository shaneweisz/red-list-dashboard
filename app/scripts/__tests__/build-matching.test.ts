/**
 * build-matching test (#271, Phase 3): drives the real run() over tiny synthetic
 * parquets + a redlist CSV in a temp dir, then inspects species_link.parquet.
 * Focus: the matching ladder — accepted, CoL-synonym, and especially the
 * IUCN-synonym fallback (a species whose CURRENT name CoL doesn't know, but whose
 * IUCN-recorded synonym equals a CoL accepted name — the genus-reassignment case
 * that name-joins on the canonical name alone miss). Self-contained (DuckDB only).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { DuckDBInstance } from "@duckdb/node-api";
import { run } from "../build-matching";

let tmp: string;
let link: string;

beforeAll(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "matching-test-"));
  fs.mkdirSync(path.join(tmp, "species"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "redlist"), { recursive: true });
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  const copy = (sql: string, file: string) => conn.run(`COPY (${sql}) TO '${path.join(tmp, file)}' (FORMAT PARQUET);`);

  // CoL accepted species (col_acc source). VE + SA are the same bird as two accepted
  // concepts (the Verreauxia/Sasia africana case).
  await copy(`SELECT * FROM (VALUES
      ('C1','Panthera leo','mammalia','felidae'),
      ('C2','Macronycteris vittatus','mammalia','hipposideridae'),
      ('C3','Felis catus','mammalia','felidae'),
      ('C4','Apis mellifera','insecta','apidae'),
      ('VE','Verreauxia africana','aves','picidae'),
      ('SA','Sasia africana','aves','picidae'),
      ('48DGM','Ochotona pallasi','mammalia','ochotonidae'),
      ('4XWZC','Sminthopsis griseoventer','mammalia','dasyuridae'),
      ('C5','Aloeides dentatis','insecta','lycaenidae'),
      ('C6','Aloeides dentatus','insecta','lycaenidae'),
      ('C7','Ochotona curzoniae','mammalia','ochotonidae')
    ) v(col_id, scientific_name, class_name, family)`, "species/data_0.parquet");

  // CoL backbone (col_syn source): one species-rank synonym → accepted parent C3.
  await copy(`SELECT * FROM (VALUES
      ('C3', NULL, 'accepted', 'species', 'Felis catus'),
      ('S1', 'C3', 'synonym', 'species', 'Felis silvestris catus'),
      -- Real CoL records behind the variant pass. 48DGM is accepted under a
      -- spelling the Red List doesn't use; 4XWZ9 is a SYNONYM whose parent is the
      -- species the assessment is really about.
      ('48DGM', NULL, 'accepted', 'species', 'Ochotona pallasi'),
      ('SS1', '48DGM', 'accepted', 'subspecies', 'Ochotona pallasi hamica'),
      ('C7', NULL, 'accepted', 'species', 'Ochotona curzoniae'),
      ('4XWZC', NULL, 'accepted', 'species', 'Sminthopsis griseoventer'),
      ('4XWZ9', '4XWZC', 'synonym', 'species', 'Sminthopsis fuliginosus'),
      ('C5', NULL, 'accepted', 'species', 'Aloeides dentatis'),
      ('C6', NULL, 'accepted', 'species', 'Aloeides dentatus'),
      ('MIS', 'C3', 'misapplied', 'species', 'Felis domestica'),
      -- CoL holding ONE species as two accepted records, which is what a normalised
      -- collision actually is. Both normalise to "ascaltis lamarck".
      ('D1', NULL, 'accepted', 'species', 'Ascaltis lamarckii'),
      ('D2', NULL, 'accepted', 'species', 'Ascaltis lamarcki'),
      -- Provisionally accepted: absent from col_acc, so pass 1 cannot see it even
      -- though the name is spelled identically.
      ('PV1', NULL, 'provisionally accepted', 'species', 'Idaea josephinae'),
      -- An accepted record must outrank a provisional one for the same key.
      ('PV2', NULL, 'provisionally accepted', 'species', 'Aloeides dentatum'),
      -- Species-rank synonym reachable only by normalising.
      ('SY2', 'C3', 'synonym', 'species', 'Felis catta'),
      -- Pass 7. X8JX is the real record behind the reported case: CoL spells
      -- Pungeler's moth without the diaeresis, IUCN transliterates it, and no
      -- termination rule brings the two together.
      ('X8JX', NULL, 'accepted', 'species', 'Colostygia pungeleri'),
      -- The refusal that proves the key is not simply believed: GBIF's index put
      -- the Red List's 'Agrotis sabine' on this record, a different name AND a
      -- synonym. 95SNW must never be linked.
      ('95SNW', 'AGR1', 'synonym', 'species', 'Agrotis sabura'),
      ('AGR1', NULL, 'accepted', 'species', 'Agrotis segetum'),
      -- An orthographic variant that is a SYNONYM resolves to its parent, as
      -- passes 2 and 5 do.
      ('IVA2', 'IVA1', 'synonym', 'species', 'Iva xanthiifolia'),
      ('IVA1', NULL, 'accepted', 'species', 'Cyclachaena xanthiifolia')
    ) v(col_id, parent_id, status, rank, scientific_name)`, "backbone.parquet");

  // Our IUCN-assessed species.
  // gbif_species_key is a CoL id (VARCHAR) since GBIF's index moved to CoL — it is
  // what pass 4 validates.
  await copy(`SELECT * FROM (VALUES
      (1::BIGINT, 'Panthera leo', 'mammalia', 'felidae', NULL::VARCHAR),
      (2::BIGINT, 'Felis silvestris catus', 'mammalia', 'felidae', NULL::VARCHAR),
      (3::BIGINT, 'Hipposideros vittatus', 'mammalia', 'hipposideridae', NULL::VARCHAR),
      (4::BIGINT, 'Gone extinctus', 'mammalia', 'nowhere', NULL::VARCHAR),
      (5::BIGINT, 'Verreauxia africana', 'aves', 'picidae', NULL::VARCHAR),
      -- Pass 4, the two reported cases.
      (6::BIGINT, 'Ochotona pallasii', 'mammalia', 'ochotonidae', '48DGM'),
      (7::BIGINT, 'Sminthopsis fuliginosa', 'mammalia', 'dasyuridae', '4XWZ9'),
      -- Pass 4 must decline these.
      (8::BIGINT, 'Ochotona nubrica', 'mammalia', 'ochotonidae', 'C7'),
      (9::BIGINT, 'Ochotona hamica', 'mammalia', 'ochotonidae', 'SS1'),
      (10::BIGINT, 'Felis domestica', 'mammalia', 'felidae', 'MIS'),
      -- Pass 1 must win over the variant passes for this one.
      (11::BIGINT, 'Aloeides dentatis', 'insecta', 'lycaenidae', 'C6'),
      -- Ambiguous: normalises onto two accepted CoL records (D1/D2).
      (12::BIGINT, 'Ascaltis lamarckii', 'insecta', 'lycaenidae', NULL::VARCHAR),
      -- Provisionally accepted, spelled identically — no GBIF key at all.
      (13::BIGINT, 'Idaea josephinae', 'insecta', 'geometridae', NULL::VARCHAR),
      -- Reaches a species-rank SYNONYM only after normalising → accepted parent C3.
      (14::BIGINT, 'Felis cattus', 'mammalia', 'felidae', NULL::VARCHAR),
      -- Pass 7: spelling differs INSIDE the name, so passes 4-6 all miss; GBIF's
      -- key names the record, and the two are one name differently spelled.
      (15::BIGINT, 'Colostygia puengeleri', 'insecta', 'geometridae', 'X8JX'),
      -- Pass 7 must refuse this: GBIF's key names a different name entirely.
      (16::BIGINT, 'Agrotis sabine', 'insecta', 'noctuidae', '95SNW'),
      -- Pass 7 onto a synonym resolves to the accepted parent.
      (17::BIGINT, 'Iva xanthifolia', 'magnoliopsida', 'asteraceae', 'IVA2'),
      -- A GBIF key pointing nowhere in CoL cannot invent a match.
      (18::BIGINT, 'Nusquam inventus', 'insecta', 'nowhere', 'NOSUCH')
    ) v(id, scientific_name, class_name, family, gbif_species_key)`, "assessed.parquet");

  // GBIF-only species (no IUCN synonyms).
  await copy(`SELECT * FROM (VALUES
      (101::BIGINT, 'Apis mellifera', 'insecta', 'apidae', '1001')
    ) v(id, scientific_name, class_name, family, gbif_species_key)`, "unassessed.parquet");

  // Redlist CSV with the IUCN synonym source: sis 3 (Hipposideros vittatus) records
  // the synonym "Macronycteris vittatus" — which is CoL's accepted name (C2).
  fs.writeFileSync(path.join(tmp, "redlist", "mammals.csv"),
    "sis_taxon_id,synonyms\n1,\n2,\n3,Macronycteris vittatus:NEW\n4,\n5,Sasia africana:NEW\n" +
    "6,\n7,\n8,\n9,\n10,\n11,\n12,\n13,\n14,\n15,\n16,\n17,\n18,\n");

  await run({ dataDir: tmp });
  link = path.join(tmp, "species_link.parquet");
});

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function rows(): Promise<Record<string, unknown>[]> {
  const conn = await (await DuckDBInstance.create(":memory:")).connect();
  return (await (await conn.run(`SELECT id, col_id, match_method FROM '${link}' ORDER BY id`)).getRowObjects());
}

describe("build-matching ladder", () => {
  it("matches a canonical name to a CoL accepted species", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 1)!;
    expect([r.col_id, r.match_method]).toEqual(["C1", "accepted"]);
  });

  it("matches a canonical name that is a CoL synonym → accepted parent", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 2)!;
    expect([r.col_id, r.match_method]).toEqual(["C3", "synonym"]);
  });

  it("falls back to an IUCN-recorded synonym when the canonical name is unknown to CoL", async () => {
    // Hipposideros vittatus is not in CoL; its IUCN synonym Macronycteris vittatus is
    // CoL's accepted name (C2) — so it resolves there instead of going unmatched.
    const r = (await rows()).find((x) => Number(x.id) === 3)!;
    expect([r.col_id, r.match_method]).toEqual(["C2", "iucn_synonym"]);
  });

  it("leaves a species with no canonical or synonym hit unmatched", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 4)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("matches GBIF-only species too (no IUCN synonyms involved)", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 101)!;
    expect([r.col_id, r.match_method]).toEqual(["C4", "accepted"]);
  });

});

describe("build-matching passes 4-6 — normalised name and provisional", () => {
  // The two reported cases. Both were reported as having no CoL match at all.
  it("matches an accepted name the Red List spells differently (Ochotona pallasii / pallasi)", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 6)!;
    expect([r.col_id, r.match_method]).toEqual(["48DGM", "accepted_variant"]);
  });

  it("resolves a normalised SYNONYM to its accepted parent (Sminthopsis fuliginosa)", async () => {
    // CoL's Sminthopsis fuliginosus is a synonym of S. griseoventer. The link must
    // point at the accepted species, exactly as pass 2 does — otherwise griseoventer
    // keeps counting as unassessed while its assessment sits unmatched.
    const r = (await rows()).find((x) => Number(x.id) === 7)!;
    expect([r.col_id, r.match_method]).toEqual(["4XWZC", "synonym_variant"]);
  });

  it("reaches a species-rank synonym that only normalising exposes", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 14)!;
    expect([r.col_id, r.match_method]).toEqual(["C3", "synonym_variant"]);
  });

  it("links a name CoL only PROVISIONALLY accepts, with no GBIF key involved", async () => {
    // Spelled identically; unmatched purely because col_acc is the accepted-only
    // universe. Nothing about this species is a spelling variant.
    const r = (await rows()).find((x) => Number(x.id) === 13)!;
    expect([r.col_id, r.match_method]).toEqual(["PV1", "provisional"]);
  });

  it("refuses an ambiguous normalised key instead of guessing", async () => {
    // Ascaltis lamarckii and Ascaltis lamarcki are one species CoL holds twice.
    // Picking either would hand the assessment to whichever sorted first.
    const r = (await rows()).find((x) => Number(x.id) === 12)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("refuses a genus transfer — that is a taxonomic act, not a spelling", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 8)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("refuses a subspecies: a rank disagreement is not a spelling one", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 9)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("refuses a misapplied name, which is evidence AGAINST the two being one name", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 10)!;
    expect([r.col_id, r.match_method]).toEqual([null, "unmatched"]);
  });

  it("never outranks an exact name match", async () => {
    // Aloeides dentatis IS a CoL accepted name (C5), and also normalises onto the
    // accepted C6 and the provisional PV2. The name the assessment uses must win.
    const r = (await rows()).find((x) => Number(x.id) === 11)!;
    expect([r.col_id, r.match_method]).toEqual(["C5", "accepted"]);
  });
});

describe("build-matching ladder (continued)", () => {
  it("covers BOTH accepted concepts of a species split across CoL sources (no false NE)", async () => {
    // IUCN Verreauxia africana matches CoL accepted 'Verreauxia africana' (VE), but its
    // IUCN synonym 'Sasia africana' is a second CoL accepted concept (SA) for the same
    // bird. Both must be recorded so neither resurfaces as a new candidate.
    const r5 = (await rows()).filter((x) => Number(x.id) === 5);
    const byCol = new Map(r5.map((x) => [x.col_id, x.match_method]));
    expect(byCol.get("VE")).toBe("accepted");            // primary
    expect(byCol.get("SA")).toBe("iucn_synonym_covered"); // the in-universe duplicate, covered
    // The NE de-dup keys on DISTINCT redlist col_id — both VE and SA are excluded.
    expect(new Set(r5.map((x) => x.col_id))).toEqual(new Set(["VE", "SA"]));
  });
});

describe("build-matching pass 7 — orthographic variant, corroborated by GBIF", () => {
  // Passes 4-6 normalise Latin TERMINATIONS. A difference INSIDE the name defeats
  // them, so these rows reached pass 7 with no match at all. What makes acting on
  // GBIF's key safe here is that it is never acted on alone: the record it names
  // has to hold the same name, differently spelled.
  it("links the reported case, which no earlier pass could reach", async () => {
    // Colostygia puengeleri / CoL's Colostygia pungeleri — Rudolf Pungeler's name
    // transliterated one way by IUCN and stripped of its diaeresis by CoL. The
    // dashboard reported "No CoL match" while holding X8JX as its GBIF key.
    const r = (await rows()).find((x) => Number(x.id) === 15)!;
    expect(r.col_id).toBe("X8JX");
    expect(r.match_method).toBe("orthographic_variant");
  });

  it("REFUSES a key whose record is a different name", async () => {
    // The reason this is a corroboration and not a shortcut. GBIF's matcher put
    // Agrotis sabine on Agrotis sabura Mabille, 1888. Believing the key would
    // hand this assessment another species' occurrence records; #490 removed the
    // pass that did exactly that.
    const r = (await rows()).find((x) => Number(x.id) === 16)!;
    expect(r.col_id).toBeNull();
    expect(r.match_method).toBe("unmatched");
  });

  it("resolves a variant that is a synonym to its accepted parent", async () => {
    // Same rule as passes 2 and 5: the link points at the accepted concept, not
    // at the synonym record GBIF happened to name.
    const r = (await rows()).find((x) => Number(x.id) === 17)!;
    expect(r.col_id).toBe("IVA1");
    expect(r.match_method).toBe("orthographic_variant");
  });

  it("cannot invent a match from a key CoL does not hold", async () => {
    const r = (await rows()).find((x) => Number(x.id) === 18)!;
    expect(r.col_id).toBeNull();
    expect(r.match_method).toBe("unmatched");
  });

  it("never overrides an earlier pass", async () => {
    // Pass 7 is last for a reason: every earlier pass reasons from the name or
    // from recorded synonymy, and only this one leans on a third party. Row 11's
    // GBIF key points at C6 while its own name matches C5 exactly — pass 1 must
    // still win, or a GBIF key could silently move an exactly-matched species.
    const r = (await rows()).find((x) => Number(x.id) === 11)!;
    expect(r.col_id).toBe("C5");
    expect(r.match_method).toBe("accepted");
  });
});
