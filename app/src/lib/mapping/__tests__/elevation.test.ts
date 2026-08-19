import { describe, it, expect } from "vitest";
import {
  decodeElevation,
  formatElevation,
  sampleElevation,
  tilePosition,
} from "../elevation";

describe("decodeElevation", () => {
  // Values read off real terrarium tiles, checked against SRTM at the same points.
  it("decodes the terrarium encoding", () => {
    expect(decodeElevation(132, 213, 67)).toBeCloseTo(1237.26, 2); // Quindío, Colombia
    expect(decodeElevation(162, 25, 172)).toBeCloseTo(8729.67, 2); // near Everest
    expect(decodeElevation(128, 0, 0)).toBe(0); // the offset itself
  });

  // Terrarium carries bathymetry, so the sea floor is a real negative reading
  // rather than a missing value.
  it("decodes below sea level", () => {
    expect(decodeElevation(113, 19, 234)).toBeCloseTo(-3820.09, 2);
  });
});

describe("tilePosition", () => {
  it("places a coordinate in its tile at the deepest zoom terrarium has", () => {
    const p = tilePosition(-75.8, 4.5);
    expect(p.z).toBe(15);
    expect(p.x).toBe(9484);
    expect(p.y).toBe(15973);
    expect(p.px).toBeGreaterThanOrEqual(0);
    expect(p.px).toBeLessThan(256);
  });

  // z16 is a 404 on this tile set, so asking for more has to quietly stop.
  it("never asks for a zoom the tiles don't have", () => {
    expect(tilePosition(0, 0, 22).z).toBe(15);
  });

  it("puts the origin at the top-left of the world", () => {
    const p = tilePosition(-180, 85.05112878, 0);
    expect(p).toMatchObject({ z: 0, x: 0, y: 0 });
    expect(p.px).toBeCloseTo(0, 5);
    expect(p.py).toBeCloseTo(0, 5);
  });

  // Web Mercator can't hold the poles; without clamping the y would be Infinity.
  it("clamps beyond the Mercator limit instead of running off the map", () => {
    const p = tilePosition(0, 89.9, 5);
    expect(Number.isFinite(p.py)).toBe(true);
    expect(p.y).toBe(0);
  });
});

/** A 256×256 RGBA tile whose every pixel decodes to `metres`. */
function flatTile(metres: number): Uint8ClampedArray {
  const raw = metres + 32768;
  const r = Math.floor(raw / 256);
  const g = Math.floor(raw - r * 256);
  const b = Math.round((raw - r * 256 - g) * 256);
  const pixels = new Uint8ClampedArray(256 * 256 * 4);
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = r;
    pixels[i + 1] = g;
    pixels[i + 2] = b;
    pixels[i + 3] = 255;
  }
  return pixels;
}

describe("sampleElevation", () => {
  it("reads a flat tile as its own height", () => {
    expect(sampleElevation(flatTile(1500), 128.4, 77.9)).toBeCloseTo(1500, 3);
  });

  it("blends between neighbouring pixels", () => {
    // A west-east step: pixel 10 is at 1000 m, pixel 11 at 2000 m.
    const pixels = flatTile(1000);
    const set = (x: number, y: number, metres: number) => {
      const raw = metres + 32768;
      const i = (y * 256 + x) * 4;
      pixels[i] = Math.floor(raw / 256);
      pixels[i + 1] = raw % 256;
      pixels[i + 2] = 0;
    };
    for (let y = 0; y < 256; y++) for (let x = 11; x < 256; x++) set(x, y, 2000);
    // Pixel centres sit at x.5, so the midpoint between them is the whole
    // number between — and that's where the reading should be halfway up.
    expect(sampleElevation(pixels, 11, 100)).toBeCloseTo(1500, 0);
    expect(sampleElevation(pixels, 10.5, 100)).toBeCloseTo(1000, 0);
    expect(sampleElevation(pixels, 11.5, 100)).toBeCloseTo(2000, 0);
  });

  // The four samples straddle the tile edge at its border pixels; clamping keeps
  // the read inside the array rather than wrapping to the far side.
  it("stays inside the tile at its edges", () => {
    const pixels = flatTile(300);
    expect(sampleElevation(pixels, 0, 0)).toBeCloseTo(300, 3);
    expect(sampleElevation(pixels, 255.99, 255.99)).toBeCloseTo(300, 3);
  });
});

describe("formatElevation", () => {
  it("rounds to the metre", () => {
    expect(formatElevation(1237.26)).toBe("1,237 m");
  });

  // "-3,820 m" on its own reads like a bug rather than the sea floor.
  it("says below sea level in words", () => {
    expect(formatElevation(-3820.09)).toBe("3,820 m below sea level");
  });

  it("leaves the shoreline alone", () => {
    expect(formatElevation(-2)).toBe("-2 m");
    expect(formatElevation(0)).toBe("0 m");
  });
});
