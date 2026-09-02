import { describe, it, expect } from "vitest";
import { parseAssessors, parseInstitutions } from "../parseAssessors";

describe("parseAssessors", () => {
  it("returns empty array for null/undefined/empty", () => {
    expect(parseAssessors(null)).toEqual([]);
    expect(parseAssessors(undefined)).toEqual([]);
    expect(parseAssessors("")).toEqual([]);
    expect(parseAssessors("  ")).toEqual([]);
  });

  it("parses a single name", () => {
    expect(parseAssessors("Bernal, N.")).toEqual(["Bernal, N."]);
  });

  it("parses names separated by &", () => {
    expect(parseAssessors("Tsang, S.M. & Sheherazade")).toEqual([
      "Tsang, S.M.",
      "Sheherazade",
    ]);
  });

  it("parses names separated by commas and &", () => {
    expect(
      parseAssessors("Dunnum, J., Vargas, J. & Bernal, N.")
    ).toEqual(["Dunnum, J.", "Vargas, J.", "Bernal, N."]);
  });

  it("parses multiple names separated only by commas", () => {
    expect(
      parseAssessors("Hutson, A.M., Kingston, T., Helgen, K. & Sinaga, U.")
    ).toEqual(["Hutson, A.M.", "Kingston, T.", "Helgen, K.", "Sinaga, U."]);
  });

  it("handles names without initials (group names)", () => {
    expect(parseAssessors("Chiroptera Specialist Group")).toEqual([
      "Chiroptera Specialist Group",
    ]);
  });

  it("handles mixed group names and individual names with &", () => {
    expect(
      parseAssessors("Sheherazade, Tsang, S.M. & Matorang, Z.")
    ).toEqual(["Sheherazade", "Tsang, S.M.", "Matorang, Z."]);
  });

  it("handles parenthetical affiliations in reviewer strings", () => {
    expect(
      parseAssessors(
        "Amori, G. (Small Nonvolant Mammal Red List Authority) & Schipper, J. (Global Mammal Assessment Team)"
      )
    ).toEqual([
      "Amori, G. (Small Nonvolant Mammal Red List Authority)",
      "Schipper, J. (Global Mammal Assessment Team)",
    ]);
  });

  it("handles complex reviewer string with parens and commas", () => {
    expect(
      parseAssessors(
        "Hutson, A.M., Racey, P.A. (Chiroptera Red List Authority), Chanson, J. & Chiozza, F. (Global Mammal Assessment Team)"
      )
    ).toEqual([
      "Hutson, A.M.",
      "Racey, P.A. (Chiroptera Red List Authority)",
      "Chanson, J.",
      "Chiozza, F. (Global Mammal Assessment Team)",
    ]);
  });

  it("handles long list of names", () => {
    const result = parseAssessors(
      "Mildenstein, T., Cariño,A., Paul, S., Heaney, L., Alviola, P., Duya, A., Stier, S., Pedregosa, S., Lorica, R., Ingle, N., Balete, D., Garcia, J.J., Gonzalez, J.C., Ong, P., Rosell-Ambal, G. & Tabaranza, B."
    );
    expect(result).toContain("Mildenstein, T.");
    expect(result).toContain("Cariño,A."); // no space after comma in source data
    expect(result).toContain("Paul, S.");
    expect(result).toContain("Tabaranza, B.");
    expect(result.length).toBe(16);
  });

  it("handles IUCN SSC group name as assessor", () => {
    expect(
      parseAssessors("IUCN SSC Amphibian Specialist Group")
    ).toEqual(["IUCN SSC Amphibian Specialist Group"]);
  });

  it("normalizes 'Cox, N.' to 'Cox, N.A.' (same person)", () => {
    expect(parseAssessors("Cox, N.")).toEqual(["Cox, N.A."]);
    // Already canonical form is unchanged
    expect(parseAssessors("Cox, N.A.")).toEqual(["Cox, N.A."]);
    // Works within a list of names
    expect(
      parseAssessors("Bowles, P., Cox, N. & Stuart, S.N.")
    ).toEqual(["Bowles, P.", "Cox, N.A.", "Stuart, S.N."]);
  });

  it("handles name with complex initials and paren after comma-separated list", () => {
    expect(
      parseAssessors(
        "Hutson, A.M., Racey, P.A. (Chiroptera Red List Authority) & Stuart, S.N. (Global Mammal Assessment Team)"
      )
    ).toEqual([
      "Hutson, A.M.",
      "Racey, P.A. (Chiroptera Red List Authority)",
      "Stuart, S.N. (Global Mammal Assessment Team)",
    ]);
  });
});

describe("parseInstitutions", () => {
  it("returns [] for empty input", () => {
    expect(parseInstitutions(null)).toEqual([]);
    expect(parseInstitutions(undefined)).toEqual([]);
    expect(parseInstitutions("  ")).toEqual([]);
  });

  it("keeps a comma inside an organisation name whole", () => {
    // parseAssessors would split this into "Royal Botanic Gardens" + "Kew",
    // inventing an institution that does not exist. This is the whole reason
    // institutions get their own parser.
    expect(parseInstitutions("Royal Botanic Gardens, Kew")).toEqual(["Royal Botanic Gardens, Kew"]);
    expect(parseAssessors("Royal Botanic Gardens, Kew")).toHaveLength(2);
  });

  it("splits two institutions on the ampersand separator", () => {
    expect(parseInstitutions("Centro Nacional de Conservação da Flora (CNCFlora) & Botanic Gardens Conservation International"))
      .toEqual(["Centro Nacional de Conservação da Flora (CNCFlora)", "Botanic Gardens Conservation International"]);
  });

  // Documented limit, pinned so a future "fix" has to be a deliberate one: a
  // comma-separated line stays whole, because the same string uses ", " both
  // inside a name and between names. See parseInstitutions' KNOWN LIMIT note.
  it("does NOT split a comma-separated line, since the separator is ambiguous", () => {
    expect(parseInstitutions("Royal Botanic Gardens, Kew, Botanic Gardens Conservation International"))
      .toEqual(["Royal Botanic Gardens, Kew, Botanic Gardens Conservation International"]);
  });

  it("keeps a parenthetical acronym attached to its organisation", () => {
    expect(parseInstitutions("Centro Nacional de Conservação da Flora (CNCFlora), IUCN SSC Brazil Plant Red List Authority & Botanic Gardens Conservation International"))
      .toEqual([
        "Centro Nacional de Conservação da Flora (CNCFlora), IUCN SSC Brazil Plant Red List Authority",
        "Botanic Gardens Conservation International",
      ]);
  });
});
