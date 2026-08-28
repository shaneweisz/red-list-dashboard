import { describe, it, expect } from "vitest";
import { decodeHtmlEntities, stripHtml, truncateSections, truncateWords } from "../html-text";

describe("decodeHtmlEntities", () => {
  it("decodes decimal numeric references", () => {
    expect(decodeHtmlEntities("known&#160;from 46 sites")).toBe("known from 46 sites");
  });

  it("decodes hex numeric references", () => {
    expect(decodeHtmlEntities("2&#xB0;C")).toBe("2°C");
  });

  it("decodes named references", () => {
    expect(decodeHtmlEntities("Rich &amp; Co &ndash; 2010")).toBe("Rich & Co – 2010");
  });

  it("decodes in a single pass, so escaped references survive", () => {
    expect(decodeHtmlEntities("&amp;#160;")).toBe("&#160;");
  });

  it("leaves unknown references alone", () => {
    expect(decodeHtmlEntities("&notanentity; &#xZZ;")).toBe("&notanentity; &#xZZ;");
  });
});

describe("stripHtml", () => {
  it("decodes the &#160; that IUCN narrative text is littered with", () => {
    const input =
      "The species is known&#160;from 46 sites, with around 2,300 individuals. " +
      "Thirty-three of the sites have less than ten plants (Rich <em>et al.</em>&#160;2010).";
    expect(stripHtml(input)).toBe(
      "The species is known from 46 sites, with around 2,300 individuals. " +
        "Thirty-three of the sites have less than ten plants (Rich et al. 2010)."
    );
  });

  it("turns block markup into line breaks", () => {
    expect(stripHtml("<p>One</p><p>Two<br/>Three</p>")).toBe("One\n\nTwo\nThree");
  });

  it("normalises literal non-breaking spaces", () => {
    expect(stripHtml("46 sites")).toBe("46 sites");
  });

  it("collapses runs of blank lines and trims", () => {
    expect(stripHtml("<p>A</p><p></p><p></p><p>B</p>  ")).toBe("A\n\nB");
  });
});

describe("truncateWords", () => {
  const text = Array.from({ length: 120 }, (_, i) => `w${i + 1}`).join(" ");

  it("leaves text at or under the limit alone", () => {
    expect(truncateWords("one two three", 3)).toEqual({ text: "one two three", truncated: false });
  });

  it("keeps exactly `limit` words when cutting", () => {
    const { text: cut, truncated } = truncateWords(text, 100);
    expect(truncated).toBe(true);
    expect(cut.split(/\s+/)).toHaveLength(100);
    expect(cut.endsWith("w100")).toBe(true);
  });

  it("preserves paragraph breaks inside the kept text", () => {
    expect(truncateWords("one two\n\nthree four", 3).text).toBe("one two\n\nthree");
  });

  it("handles leading whitespace without miscounting", () => {
    expect(truncateWords("  one two three", 2)).toEqual({ text: "  one two", truncated: true });
  });
});

describe("truncateSections", () => {
  const words = (n: number, prefix: string) =>
    Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`).join(" ");

  it("keeps every section when the budget covers them all", () => {
    const input = [{ title: "a", text: words(10, "a") }, { title: "b", text: words(10, "b") }];
    const out = truncateSections(input, 100);
    expect(out.truncated).toBe(false);
    expect(out.sections.map((s) => s.title)).toEqual(["a", "b"]);
    expect(out.sections.every((s) => !s.truncated)).toBe(true);
  });

  it("spends one budget across sections and drops everything after the cut", () => {
    const input = [
      { title: "a", text: words(60, "a") },
      { title: "b", text: words(60, "b") },
      { title: "c", text: words(60, "c") },
    ];
    const out = truncateSections(input, 100);
    expect(out.truncated).toBe(true);
    expect(out.sections.map((s) => s.title)).toEqual(["a", "b"]);
    expect(out.sections[0].truncated).toBe(false);
    expect(out.sections[1].truncated).toBe(true);
    // 60 whole + 40 of the next = the full budget, nothing more
    expect(out.sections.reduce((n, s) => n + s.text.split(/\s+/).length, 0)).toBe(100);
  });

  it("cuts inside the first section when it alone exceeds the budget", () => {
    const out = truncateSections([{ title: "a", text: words(300, "a") }, { title: "b", text: "b1" }], 100);
    expect(out.sections.map((s) => s.title)).toEqual(["a"]);
    expect(out.sections[0].truncated).toBe(true);
  });

  it("reports truncation when the budget lands exactly on a boundary with more to come", () => {
    const out = truncateSections([{ title: "a", text: words(100, "a") }, { title: "b", text: "b1" }], 100);
    expect(out.truncated).toBe(true);
    expect(out.sections.map((s) => s.title)).toEqual(["a"]);
    expect(out.sections[0].truncated).toBe(false); // section a itself is whole
  });

  it("is not truncated when the budget lands exactly on the last section", () => {
    const out = truncateSections([{ title: "a", text: words(100, "a") }], 100);
    expect(out.truncated).toBe(false);
  });
});
