/**
 * build-sampling-effort-layer: GBIF sampling effort → a Web Mercator PNG
 *
 * Renders El-Gabbas's global sampling-effort raster as a single map overlay.
 * The layer answers the question a record map cannot: whether a blank area is
 * empty because the species isn't there, or because nobody has looked. That is
 * the caveat behind Red List Guidelines §4.10.8 — a record-based AOO is a lower
 * bound — and this is the only thing that makes it visible.
 *
 * Data: https://osf.io/qdwfe/ (all groups, cumulative). Cite El-Gabbas, A.
 * (2026) "A global, taxon-stratified, high-resolution sampling-effort dataset
 * from GBIF for bias-aware ecological modelling", Diversity and Distributions.
 * The README grants use of "the code, pre-computed raster products, or derived
 * outputs" on condition of that citation, which the map attribution carries.
 *
 * Why a pre-rendered PNG rather than reading the GeoTIFF in the browser: the
 * source is ZSTD-compressed, which browsers can't decode without a wasm
 * dependency, and OSF serves no CORS header. Both point the same way — convert
 * once here, serve a plain image.
 *
 * Usage:
 *   npx tsx scripts/build-sampling-effort-layer.ts                 # n_obs at 10km
 *   npx tsx scripts/build-sampling-effort-layer.ts n_sp 5          # species, 5km
 *   npx tsx scripts/build-sampling-effort-layer.ts --out /tmp/x.png
 */

import * as zlib from "zlib";
import { deflateSync } from "zlib";

// Node has had zstd since 22.15; the @types/node pinned here hasn't caught up.
const { zstdDecompressSync } = zlib as unknown as {
  zstdDecompressSync: (buf: Buffer) => Buffer;
};
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";

/** The all-groups cumulative products, by metric and resolution in km. */
const OSF_FILES: Record<string, Record<number, string>> = {
  n_obs: { 1: "n_obs_1.tif", 5: "n_obs_5.tif", 10: "n_obs_10.tif", 20: "n_obs_20.tif" },
  n_sp: { 1: "n_sp_1.tif", 5: "n_sp_5.tif", 10: "n_sp_10.tif", 20: "n_sp_20.tif" },
};

const OSF_NODE = "qdwfe";

interface Raster {
  width: number;
  height: number;
  /** Row-major, already cropped to width × height. */
  values: Uint32Array;
}

/**
 * Reads the tiled, ZSTD-compressed GeoTIFF these products ship as.
 *
 * Deliberately narrow: it handles this one layout (classic little-endian TIFF,
 * single uint32 band, 256×256 tiles) and throws on anything else rather than
 * pretending to be a GeoTIFF library.
 */
function readGeoTiff(buf: Buffer): Raster {
  if (buf.readUInt16LE(0) !== 0x4949 || buf.readUInt16LE(2) !== 42) {
    throw new Error("not a classic little-endian TIFF");
  }
  const ifd = buf.readUInt32LE(4);
  const count = buf.readUInt16LE(ifd);
  const tags = new Map<number, { type: number; count: number; valueOffset: number }>();
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    tags.set(buf.readUInt16LE(e), {
      type: buf.readUInt16LE(e + 2),
      count: buf.readUInt32LE(e + 4),
      valueOffset: e + 8,
    });
  }
  const scalar = (tag: number): number => {
    const t = tags.get(tag);
    if (!t) throw new Error(`missing TIFF tag ${tag}`);
    return t.type === 3 ? buf.readUInt16LE(t.valueOffset) : buf.readUInt32LE(t.valueOffset);
  };
  const array = (tag: number): number[] => {
    const t = tags.get(tag);
    if (!t) throw new Error(`missing TIFF tag ${tag}`);
    const size = (t.type === 3 ? 2 : 4) * t.count;
    const at = size > 4 ? buf.readUInt32LE(t.valueOffset) : t.valueOffset;
    const out: number[] = [];
    for (let i = 0; i < t.count; i++) {
      out.push(t.type === 3 ? buf.readUInt16LE(at + i * 2) : buf.readUInt32LE(at + i * 4));
    }
    return out;
  };

  const width = scalar(256);
  const height = scalar(257);
  if (scalar(258) !== 32 || scalar(277) !== 1) throw new Error("expected a single 32-bit band");
  if (scalar(259) !== 50000) throw new Error(`expected ZSTD compression, got ${scalar(259)}`);
  const tileWidth = scalar(322);
  const tileHeight = scalar(323);
  const offsets = array(324);
  const byteCounts = array(325);

  const across = Math.ceil(width / tileWidth);
  const values = new Uint32Array(width * height);
  for (let t = 0; t < offsets.length; t++) {
    if (byteCounts[t] === 0) continue;
    const tile = new Uint32Array(
      zstdDecompressSync(buf.subarray(offsets[t], offsets[t] + byteCounts[t])).buffer
    );
    const x0 = (t % across) * tileWidth;
    const y0 = Math.floor(t / across) * tileHeight;
    for (let ty = 0; ty < tileHeight; ty++) {
      const y = y0 + ty;
      // Tiles are padded out past the image edge; that padding isn't data.
      if (y >= height) break;
      for (let tx = 0; tx < tileWidth; tx++) {
        const x = x0 + tx;
        if (x >= width) break;
        values[y * width + x] = tile[ty * tileWidth + tx];
      }
    }
  }
  return { width, height, values };
}

/**
 * Viridis, sampled. Perceptually uniform and colour-blind safe, and — the
 * reason it's used for this kind of surface everywhere — it reads as a
 * quantity rather than as a category, which is what separates it from the
 * habitat and ecosystem layers.
 */
const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142],
  [38, 130, 142], [31, 158, 137], [53, 183, 121], [110, 206, 88],
  [181, 222, 43], [253, 231, 37],
];

function viridis(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (VIRIDIS.length - 1);
  const i = Math.min(VIRIDIS.length - 2, Math.floor(x));
  const f = x - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/**
 * Warps the plate carrée source into Web Mercator and colours it.
 *
 * The warp is necessary rather than fussy: MapLibre lays an image source
 * linearly across its four corners *in Mercator space*, so handing it an
 * equirectangular image puts everything above the tropics in the wrong place.
 *
 * Zero is drawn fully transparent. There is no nodata in this raster — ocean
 * and unsurveyed land are both plain zero — so painting zero would blanket the
 * world, and leaving it clear is also the more honest reading: colour means
 * somebody looked.
 */
function render(source: Raster, size: number): { rgba: Uint8Array; max: number } {
  let max = 0;
  for (const v of source.values) if (v > max) max = v;
  const logMax = Math.log1p(max);
  const rgba = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    // Pixel centre → Mercator y in [-1, 1] → latitude.
    const merc = 1 - (2 * (y + 0.5)) / size;
    const lat = (Math.atan(Math.sinh(Math.PI * merc)) * 180) / Math.PI;
    const srcY = Math.min(
      source.height - 1,
      Math.max(0, Math.floor(((90 - lat) / 180) * source.height))
    );
    for (let x = 0; x < size; x++) {
      const lon = -180 + (360 * (x + 0.5)) / size;
      const srcX = Math.min(
        source.width - 1,
        Math.max(0, Math.floor(((lon + 180) / 360) * source.width))
      );
      const value = source.values[srcY * source.width + srcX];
      const o = (y * size + x) * 4;
      if (value === 0) continue; // transparent
      const [r, g, b] = viridis(Math.log1p(value) / logMax);
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = b;
      // Faint where a cell holds a single record, solid where it's well worked.
      rgba[o + 3] = Math.round(90 + 165 * (Math.log1p(value) / logMax));
    }
  }
  return { rgba, max };
}

/** Minimal PNG encoder — a truecolour-with-alpha image is four chunks. */
function encodePng(rgba: Uint8Array, size: number): Buffer {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(data.length + 12);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    data.copy(out, 8);
    out.writeInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour with alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

let CRC_TABLE: Int32Array | null = null;
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) | 0;
}

async function main() {
  // Flags take a value, so both have to come out before what's left can be read
  // positionally — dropping only the "--name" left its value to be mistaken for
  // the metric, and `--out x.png` was read as a request for a metric called
  // "x.png".
  const argv = process.argv.slice(2);
  const flags = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) flags.set(argv[i], argv[++i] ?? "");
    else positional.push(argv[i]);
  }
  const metric = positional[0] ?? "n_obs";
  const resolution = Number(positional[1] ?? 10);
  const out = flags.get("--out") ?? `sampling-effort-${metric}-${resolution}km.png`;
  const size = Number(flags.get("--size") ?? 2048);

  const name = OSF_FILES[metric]?.[resolution];
  if (!name) throw new Error(`no product for ${metric} at ${resolution}km`);

  console.log(`Finding ${name} on OSF project ${OSF_NODE}…`);
  const listing = await fetch(`https://api.osf.io/v2/nodes/${OSF_NODE}/files/osfstorage/`);
  const files = (await listing.json()) as { data: { attributes: { name: string }; links: { download: string } }[] };
  const entry = files.data.find((f) => f.attributes.name === name);
  if (!entry) throw new Error(`${name} not found on the OSF project`);

  console.log(`Downloading ${entry.links.download}…`);
  const buf = Buffer.from(await (await fetch(entry.links.download)).arrayBuffer());
  console.log(`  ${(buf.length / 1e6).toFixed(2)} MB`);

  const raster = readGeoTiff(buf);
  console.log(`Decoded ${raster.width} × ${raster.height}`);

  const { rgba, max } = render(raster, size);
  const png = encodePng(rgba, size);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, png);
  console.log(`Wrote ${out} — ${size} × ${size}, ${(png.length / 1e6).toFixed(2)} MB, max ${max.toLocaleString()} per cell`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
