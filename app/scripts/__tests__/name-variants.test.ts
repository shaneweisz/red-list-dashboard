/**
 * name-variants test: the rule build-matching indexes Catalogue of Life by in
 * passes 4-6 of the matching ladder.
 *
 * Every positive case is a real Red List assessment whose name CoL spells
 * differently, drawn from the species reported as having no CoL match at all.
 * Every negative is a real case from the same set that must NOT be swept up: a
 * genus transfer, a doubled consonant, a patronymic gender change.
 *
 * The negatives matter more than the positives. A missed variant leaves one
 * species visibly unmatched, which is recoverable; a wrong match silently hands
 * one species' occurrence records and assessment to another.
 */
import { describe, it, expect } from "vitest";
import { sameSpeciesName, canonicalEpithet, speciesNameParts, normalisedKey } from "../name-variants";

describe("speciesNameParts", () => {
  it("drops a parenthesised subgenus", () => {
    // CoL prints Ochotona pallasi with its subgenus; the Red List doesn't.
    expect(speciesNameParts("Ochotona (Pika) pallasi")).toEqual(["ochotona", "pallasi"]);
  });

  it("drops the hybrid sign but keeps a literal ASCII x", () => {
    expect(speciesNameParts("Agave × peacockii")).toEqual(["agave", "peacockii"]);
    // "xanthina" must survive intact — stripping ASCII x would corrupt it.
    expect(speciesNameParts("Aloe xanthina")).toEqual(["aloe", "xanthina"]);
  });

  it("declines anything that is not a binomial", () => {
    expect(speciesNameParts("Ochotona")).toBeNull();
    expect(speciesNameParts("Ochotona pallasi hamica")).toBeNull();
    expect(speciesNameParts("")).toBeNull();
  });
});

describe("canonicalEpithet", () => {
  it("collapses a doubled terminal i without stripping the patronymic i", () => {
    expect(canonicalEpithet("pallasii")).toBe("pallasi");
    expect(canonicalEpithet("pallasi")).toBe("pallasi");
  });

  it("never reduces an epithet to nothing", () => {
    // Without the length guard these would all normalise to "" and so to each other.
    expect(canonicalEpithet("ova")).not.toBe("");
    expect(canonicalEpithet("us")).toBe("us");
    expect(canonicalEpithet("a")).toBe("a");
  });
});

describe("sameSpeciesName — variants the codes deem identical", () => {
  const same: [string, string, string][] = [
    ["patronymic -ii/-i", "Ochotona pallasii", "Ochotona (Pika) pallasi"],
    ["patronymic -ii/-i", "Anolis wattsi", "Anolis wattsii"],
    ["patronymic -ii/-i", "Agave promontori", "Agave promontorii"],
    ["gender -a/-us", "Sminthopsis fuliginosa", "Sminthopsis fuliginosus"],
    ["gender -a/-us", "Alluroteuthis antarctica", "Alluroteuthis antarcticus"],
    ["gender -a/-um", "Acacia verricula", "Acacia verriculum"],
    ["gender -um/-a", "Angraecum muscicolum", "Angraecum muscicola"],
    ["gender -is/-us", "Aloeides dentatis", "Aloeides dentatus"],
    ["third declension -is/-e", "Allium lefkadensis", "Allium lefkadense"],
    ["third declension -is/-e", "Allium apolloniensis", "Allium apolloniense"],
    ["hybrid sign only", "Agave peacockii", "Agave × peacockii"],
    ["identical", "Panthera leo", "Panthera leo"],
  ];
  for (const [why, iucn, col] of same) {
    it(`${why}: ${iucn} = ${col}`, () => {
      expect(sameSpeciesName(iucn, col)).toBe(true);
      expect(sameSpeciesName(col, iucn)).toBe(true); // symmetric
    });
  }
});

describe("sameSpeciesName — differences that need evidence this check hasn't got", () => {
  const different: [string, string, string][] = [
    ["a genus transfer is a taxonomic act, not a spelling",
      "Agrochola kindermannii", "Anchoscelis kindermanni"],
    ["a doubled consonant is a corrected misspelling",
      "Aframomum elliotii", "Aframomum elliottii"],
    ["a doubled consonant is a corrected misspelling",
      "Annesorhiza burttii", "Annesorhiza burtii"],
    ["patronymic gender -i/-ae needs the original description",
      "Acrogomphus walshi", "Acrogomphus walshae"],
    ["an inserted syllable is not a termination",
      "Annona xylopiifolia", "Annona xylopifolia"],
    ["an inserted syllable is not a termination",
      "Agathis labillardieri", "Agathis labillardierei"],
    ["different species in the same genus stay different",
      "Ochotona pallasii", "Ochotona curzoniae"],
    ["a subspecies is a different rank",
      "Ochotona pallasii", "Ochotona pallasi hamica"],
  ];
  for (const [why, a, b] of different) {
    it(`${why}: ${a} ≠ ${b}`, () => {
      expect(sameSpeciesName(a, b)).toBe(false);
      expect(sameSpeciesName(b, a)).toBe(false);
    });
  }

  it("does not let two real congeners collide through the stem", () => {
    // The guard that matters: stripping a termination must not make distinct
    // epithets equal. These pairs differ before the ending, so they must survive.
    expect(sameSpeciesName("Acacia alba", "Acacia albida")).toBe(false);
    expect(sameSpeciesName("Allium nigrum", "Allium nigricans")).toBe(false);
  });
});

describe("normalisedKey — the form build-matching indexes on", () => {
  it("gives one species' spellings a single key", () => {
    expect(normalisedKey("Ochotona pallasii")).toBe(normalisedKey("Ochotona (Pika) pallasi"));
    expect(normalisedKey("Sminthopsis fuliginosa")).toBe(normalisedKey("Sminthopsis fuliginosus"));
    // The CoL duplicate that makes the ambiguity guard necessary.
    expect(normalisedKey("Ascaltis lamarckii")).toBe(normalisedKey("Ascaltis lamarcki"));
  });

  it("keeps distinct species apart", () => {
    expect(normalisedKey("Ochotona pallasii")).not.toBe(normalisedKey("Ochotona curzoniae"));
    expect(normalisedKey("Agrochola kindermannii")).not.toBe(normalisedKey("Anchoscelis kindermanni"));
  });

  it("is null for anything that is not a binomial", () => {
    expect(normalisedKey("Ochotona pallasi hamica")).toBeNull();
    expect(normalisedKey("Ochotona")).toBeNull();
  });
});
