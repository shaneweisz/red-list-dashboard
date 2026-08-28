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
import { sameSpeciesName, canonicalEpithet, speciesNameParts, normalisedKey, orthographicallySame, orthographicKey } from "../name-variants";

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

/**
 * orthographicallySame — the SECOND, looser rule, used only to corroborate a
 * candidate GBIF's index has already produced (build-matching pass 7).
 *
 * Every positive below is a real Red List assessment that the dashboard reported
 * as having NO Catalogue of Life match while its own gbif_species_key pointed at
 * a CoL record holding the same name differently spelled. 124 assessments were
 * in that state; 86 of them are these.
 *
 * The negatives are the reason this rule is never allowed to decide alone. They
 * are cases the strict rule (sameSpeciesName) also refuses, and they must keep
 * failing here — a looser rule that swallowed them would launder GBIF's fuzzy
 * matching into an assertion about CoL.
 */
describe("orthographicallySame — spellings the codes call one name", () => {
  const same: [string, string, string][] = [
    // The case that started this: Rudolf Pungeler's name, transliterated by IUCN
    // and stripped of its diaeresis by CoL. CoL X8JX, accepted, in the checklist,
    // and we were reporting "No CoL match".
    ["umlaut transliterated vs dropped", "Colostygia puengeleri", "Colostygia pungeleri"],
    ["ij is Dutch for y", "Daphniphyllum teysmannii", "Daphniphyllum teijsmannii"],
    ["i / y interchange, ICN 60.7", "Gagea elliptica", "Gagea ellyptica"],
    ["doubled consonant, ICN 60.1", "Cestrum strigilatum", "Cestrum strigillatum"],
    ["doubled consonant, ICN 60.1", "Inga vilosissima", "Inga villosissima"],
    ["doubled i inside the epithet", "Iva xanthifolia", "Iva xanthiifolia"],
    ["doubled i inside the epithet", "Weinmannia paulliniifolia", "Weinmannia paullinifolia"],
    ["hyphen carries no weight", "Solanum rudepannum", "Solanum rude-pannum"],
    ["hyphen carries no weight", "Xylopia le-testui", "Xylopia letestui"],
    ["identical names are trivially the same", "Panthera leo", "Panthera leo"],
  ];
  for (const [why, iucn, col] of same) {
    it(`${why}: ${iucn} = ${col}`, () => {
      expect(orthographicallySame(iucn, col)).toBe(true);
      expect(orthographicallySame(col, iucn)).toBe(true); // symmetric
    });
  }

  it("accepts what the strict rule accepts, so pass 7 never contradicts passes 4-6", () => {
    // A superset, not a different rule: anything the codes call one name by
    // termination is also one name here.
    for (const [a, b] of [["Ochotona pallasii", "Ochotona pallasi"],
                          ["Sminthopsis fuliginosa", "Sminthopsis fuliginosus"],
                          ["Allium lefkadensis", "Allium lefkadense"]]) {
      expect(sameSpeciesName(a, b), `strict: ${a} / ${b}`).toBe(true);
      expect(orthographicallySame(a, b), `loose: ${a} / ${b}`).toBe(true);
    }
  });
});

describe("orthographicallySame — differences no folding may erase", () => {
  const different: [string, string, string][] = [
    // GBIF's index put this Red List assessment on Agrotis sabura Mabille, 1888
    // — a different name, and a synonym. It is why pass 7 tests the name instead
    // of believing the key, and why those 21 occurrence records are suspect.
    ["GBIF's fuzzy matcher reaching past the name", "Agrotis sabine", "Agrotis sabura"],
    ["a genus transfer is a taxonomic act", "Agrochola kindermannii", "Anchoscelis kindermanni"],
    ["different species in one genus", "Ochotona pallasii", "Ochotona curzoniae"],
    ["a subspecies is a different rank", "Ochotona pallasii", "Ochotona pallasi hamica"],
    ["an inserted syllable is not a spelling", "Agathis labillardieri", "Agathis labillardierei"],
    ["patronymic gender needs the description", "Asparagus faulknerae", "Asparagus faulkneri"],
    ["patronymic gender needs the description", "Acrogomphus walshi", "Acrogomphus walshae"],
  ];
  for (const [why, a, b] of different) {
    it(`${why}: ${a} != ${b}`, () => {
      expect(orthographicallySame(a, b)).toBe(false);
      expect(orthographicallySame(b, a)).toBe(false);
    });
  }

  it("does not let folding collapse real congeners together", () => {
    // The danger of a looser rule: dropping doubled letters and equating i/y
    // must not make distinct epithets equal.
    expect(orthographicallySame("Acacia alba", "Acacia albida")).toBe(false);
    expect(orthographicallySame("Allium nigrum", "Allium nigricans")).toBe(false);
    expect(orthographicallySame("Panthera leo", "Panthera onca")).toBe(false);
  });

  it("keeps the genus, which no orthographic rule may cross", () => {
    // Same epithet, different genus — a transfer, which passes 2/5 handle with
    // actual synonymy evidence. This rule has none.
    expect(orthographicallySame("Aplexa elongata", "Sibirenauta elongata")).toBe(false);
  });
});

describe("orthographicKey", () => {
  it("is null for anything that is not a binomial", () => {
    expect(orthographicKey("Colostygia")).toBeNull();
    expect(orthographicKey("Colostygia puengeleri stertzi")).toBeNull();
    expect(orthographicKey("")).toBeNull();
  });

  it("never folds a name part away to nothing", () => {
    // "Ii ii" folds to "i i", not to "" — otherwise every short name keys alike.
    expect(orthographicKey("Ii ii")).toBe("i i");
    expect(orthographicKey("Yy yy")).toBe("i i");
  });

  it("is looser than normalisedKey, which is why it is never used alone", () => {
    // Stated as a property so the relationship is checked rather than assumed:
    // the strict rule refuses this pair, the loose one accepts it, and only
    // GBIF pointing at the record makes the difference safe to act on.
    expect(sameSpeciesName("Iva xanthifolia", "Iva xanthiifolia")).toBe(false);
    expect(orthographicallySame("Iva xanthifolia", "Iva xanthiifolia")).toBe(true);
  });
});
