import { describe, it, expect } from "vitest";
import { hasLink, linkifyParts } from "../linkify";

const hrefs = (text: string) => linkifyParts(text).filter((p) => p.href).map((p) => p.href);
const rendered = (text: string) => linkifyParts(text).map((p) => p.text).join("");

describe("linkifyParts", () => {
  it("finds the link in a note and leaves the rest alone", () => {
    const note = "Placed from GEOLocate: https://geo-locate.org/web/WebGeoref.aspx?v=1 — 5 km radius.";
    expect(hrefs(note)).toEqual(["https://geo-locate.org/web/WebGeoref.aspx?v=1"]);
    expect(rendered(note)).toBe(note);
  });

  it("gives a bare www. address a scheme, so the link works", () => {
    expect(hrefs("see www.gbif.org/occurrence/1252668836")).toEqual([
      "https://www.gbif.org/occurrence/1252668836",
    ]);
    expect(rendered("see www.gbif.org/occurrence/1252668836")).toBe("see www.gbif.org/occurrence/1252668836");
  });

  it("leaves the full stop with the sentence rather than the link", () => {
    const parts = linkifyParts("Confirmed at https://example.org/place.");
    expect(parts.at(-1)?.text).toBe(".");
    expect(hrefs("Confirmed at https://example.org/place.")).toEqual(["https://example.org/place"]);
  });

  it("keeps a bracket that the URL itself opened", () => {
    expect(hrefs("https://en.wikipedia.org/wiki/Mitú_(Vaupés)")).toEqual([
      "https://en.wikipedia.org/wiki/Mitú_(Vaupés)",
    ]);
  });

  it("drops a bracket the sentence opened", () => {
    expect(hrefs("(see https://example.org/x)")).toEqual(["https://example.org/x"]);
  });

  it("finds every link in a note that cites several", () => {
    expect(hrefs("https://a.org/1 and then https://b.org/2")).toEqual([
      "https://a.org/1",
      "https://b.org/2",
    ]);
  });

  it("returns a note with no links as one plain part", () => {
    const note = "Two villages of this name; the collector's route says the eastern one.";
    expect(linkifyParts(note)).toEqual([{ text: note }]);
    expect(hasLink(note)).toBe(false);
  });

  it("doesn't mistake a locality's punctuation for an address", () => {
    const note = "Carretera Hollín-Loreto-Coca, km 32.5, near the río.";
    expect(hrefs(note)).toEqual([]);
  });

  it("says nothing about an empty note", () => {
    expect(linkifyParts("")).toEqual([]);
  });
});
