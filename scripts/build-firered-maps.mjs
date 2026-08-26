/**
 * Bake vendor/pokefirered tilesets + map.bin into native 16px ground/overlay PNGs.
 */
import { deflateSync } from "zlib";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pokePC = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(pokePC, "vendor", "pokefirered");
const outRoot = join(pokePC, "public", "assets", "pokefirered", "maps");

const NUM_PRIMARY_TILES = 640;
const NUM_PRIMARY_METATILES = 640;
const TILE = 16;
const WATER = new Set([0x10, 0x11, 0x12, 0x13, 0x15, 0x16, 0x17, 0x1a, 0x1b]);
const ENCOUNTER_GRASS = new Set([0x02]); // MB_TALL_GRASS

function fail(message) {
  throw new Error(`[build-firered-maps] ${message}`);
}

function assertFile(path, label) {
  if (!existsSync(path)) fail(`Missing ${label}: ${path}`);
}

function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function writePng(width, height, rgba) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function readPal(path) {
  const lines = readFileSync(path, "utf8").trim().split(/\r?\n/);
  const colors = [];
  for (const line of lines.slice(3, 19)) {
    const [r, g, b] = line.trim().split(/\s+/).map(Number);
    colors.push([r, g, b]);
  }
  while (colors.length < 16) colors.push([0, 0, 0]);
  return colors;
}

function validateTileset(kind, name) {
  const dir = join(vendor, "data", "tilesets", kind, name);
  assertFile(join(dir, "tiles.4bpp"), `${kind}/${name}/tiles.4bpp`);
  assertFile(join(dir, "metatiles.bin"), `${kind}/${name}/metatiles.bin`);
  assertFile(join(dir, "metatile_attributes.bin"), `${kind}/${name}/metatile_attributes.bin`);
  for (let i = 0; i < 16; i++) {
    assertFile(join(dir, "palettes", `${String(i).padStart(2, "0")}.pal`), `${kind}/${name}/palette ${i}`);
  }
}

function loadTileset(kind, name) {
  validateTileset(kind, name);
  const dir = join(vendor, "data", "tilesets", kind, name);
  const tiles = readFileSync(join(dir, "tiles.4bpp"));
  const metatiles = readFileSync(join(dir, "metatiles.bin"));
  const attrs = readFileSync(join(dir, "metatile_attributes.bin"));
  if (tiles.length % 32 !== 0) fail(`${kind}/${name}: tiles.4bpp length ${tiles.length} is not a multiple of 32`);
  if (metatiles.length % 16 !== 0) fail(`${kind}/${name}: metatiles.bin length ${metatiles.length} is not a multiple of 16`);
  const metaCount = metatiles.length / 16;
  if (attrs.length !== metaCount * 4) {
    fail(`${kind}/${name}: metatile_attributes.bin (${attrs.length}) != metatile count (${metaCount}) * 4`);
  }
  const palettes = [];
  for (let i = 0; i < 16; i++) {
    palettes.push(readPal(join(dir, "palettes", `${String(i).padStart(2, "0")}.pal`)));
  }
  return {
    tiles,
    metatiles,
    attrs,
    palettes,
    tileCount: tiles.length / 32,
    metaCount,
  };
}

function validateMapBin(layoutName, width, height) {
  const path = join(vendor, "data", "layouts", layoutName, "map.bin");
  assertFile(path, `layout ${layoutName}/map.bin`);
  const map = readFileSync(path);
  const expected = width * height * 2;
  if (map.length !== expected) {
    fail(`${layoutName}/map.bin size ${map.length} != expected ${expected} (${width}x${height})`);
  }
  return map;
}

function validateExtras(spec) {
  for (const [x, y, ch] of spec.extras?.cells || []) {
    if (x < 0 || y < 0 || x >= spec.width || y >= spec.height) {
      fail(`${spec.id}: override (${x},${y}) outside map bounds ${spec.width}x${spec.height}`);
    }
    if (ch !== "." && ch !== "#") fail(`${spec.id}: override (${x},${y}) must be '.' or '#', got '${ch}'`);
  }
}

function decodeTile4bpp(tiles, index) {
  const px = new Uint8Array(64);
  if (index < 0 || index * 32 + 32 > tiles.length) return px;
  const src = tiles.subarray(index * 32, index * 32 + 32);
  for (let row = 0; row < 8; row++) {
    for (let pair = 0; pair < 4; pair++) {
      const b = src[row * 4 + pair];
      px[row * 8 + pair * 2] = b & 0xf;
      px[row * 8 + pair * 2 + 1] = b >> 4;
    }
  }
  return px;
}

function blitTile(dest, destW, dx, dy, tilePx, pal, hFlip, vFlip) {
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const sx = hFlip ? 7 - x : x;
      const sy = vFlip ? 7 - y : y;
      const idx = tilePx[sy * 8 + sx];
      if (idx === 0) continue;
      const [r, g, b] = pal[idx];
      const o = ((dy + y) * destW + (dx + x)) * 4;
      dest[o] = r;
      dest[o + 1] = g;
      dest[o + 2] = b;
      dest[o + 3] = 255;
    }
  }
}

function drawQuad(dest, destW, ox, oy, tileWords, primary, secondary) {
  for (let i = 0; i < 4; i++) {
    const word = tileWords[i];
    const tileNum = word & 0x3ff;
    const hFlip = Boolean(word & 0x400);
    const vFlip = Boolean(word & 0x800);
    const palNum = (word >> 12) & 0xf;
    const set = tileNum < NUM_PRIMARY_TILES ? primary : secondary;
    const local = tileNum < NUM_PRIMARY_TILES ? tileNum : tileNum - NUM_PRIMARY_TILES;
    const pal = set.palettes[palNum];
    const tilePx = decodeTile4bpp(set.tiles, local);
    blitTile(dest, destW, ox + (i % 2) * 8, oy + Math.floor(i / 2) * 8, tilePx, pal, hFlip, vFlip);
  }
}

function getMetaTiles(set, localId) {
  const words = [];
  const off = localId * 16;
  for (let i = 0; i < 8; i++) words.push(set.metatiles.readUInt16LE(off + i * 2));
  return words;
}

function layerType(set, localId) {
  return (set.attrs.readUInt32LE(localId * 4) >> 29) & 3;
}

function behavior(set, localId) {
  return set.attrs.readUInt32LE(localId * 4) & 0x1ff;
}

function resolveSet(id, primary, secondary) {
  if (id < NUM_PRIMARY_METATILES) return { set: primary, local: id };
  return { set: secondary, local: id - NUM_PRIMARY_METATILES };
}

function renderMap(spec) {
  validateExtras(spec);
  const map = validateMapBin(spec.layout, spec.width, spec.height);
  const { primary, secondary } = spec;
  const width = spec.width;
  const height = spec.height;
  const w = width * TILE;
  const h = height * TILE;
  const ground = Buffer.alloc(w * h * 4);
  const overlay = Buffer.alloc(w * h * 4);
  const rows = [];
  const grassRows = [];

  for (let y = 0; y < height; y++) {
    let row = "";
    let grassRow = "";
    for (let x = 0; x < width; x++) {
      const cell = map.readUInt16LE((y * width + x) * 2);
      const metaId = cell & 0x3ff;
      const col = (cell >> 10) & 3;
      const { set, local } = resolveSet(metaId, primary, secondary);
      if (local < 0 || local >= set.metaCount) {
        row += "#";
        grassRow += "#";
        continue;
      }
      const tiles = getMetaTiles(set, local);
      const lt = layerType(set, local);
      const bh = behavior(set, local);
      const ox = x * TILE;
      const oy = y * TILE;
      drawQuad(ground, w, ox, oy, tiles.slice(0, 4), primary, secondary);
      if (lt === 0) drawQuad(ground, w, ox, oy, tiles.slice(4, 8), primary, secondary);
      else drawQuad(overlay, w, ox, oy, tiles.slice(4, 8), primary, secondary);
      row += col !== 0 || WATER.has(bh) ? "#" : ".";
      if (row[row.length - 1] === "#") grassRow += "#";
      else grassRow += ENCOUNTER_GRASS.has(bh) ? "G" : ".";
    }
    rows.push(row);
    grassRows.push(grassRow);
  }

  for (const [x, y, ch] of spec.extras?.cells || []) {
    const r = rows[y].split("");
    r[x] = ch;
    rows[y] = r.join("");
    const g = grassRows[y].split("");
    g[x] = ch === "#" ? "#" : g[x];
    grassRows[y] = g.join("");
  }

  return {
    id: spec.id,
    groundPng: writePng(w, h, ground),
    overlayPng: writePng(w, h, overlay),
    width,
    height,
    rows,
    grassRows,
  };
}

if (!existsSync(vendor)) {
  fail(`vendor slice missing at ${vendor}. Run: node scripts/copy-firered-vendor.mjs`);
}

const general = loadTileset("primary", "general");
const palletTownTs = loadTileset("secondary", "pallet_town");
const building = loadTileset("primary", "building");
const house1 = loadTileset("secondary", "generic_building_1");
const house2 = loadTileset("secondary", "generic_building_2");
const labTs = loadTileset("secondary", "lab");
const viridianForestTs = loadTileset("secondary", "viridian_forest");

const maps = [
  {
    id: "pallet_town",
    layout: "PalletTown",
    width: 24,
    height: 20,
    primary: general,
    secondary: palletTownTs,
    extras: {
      cells: [
        [12, 0, "#"],
        [13, 0, "#"],
        [12, 1, "#"],
        [13, 1, "#"],
        [6, 7, "."],
        [15, 7, "."],
        [16, 13, "."],
      ],
    },
  },
  {
    id: "pallet_player_house_1f",
    layout: "PalletTown_PlayersHouse_1F",
    width: 13,
    height: 10,
    primary: building,
    secondary: house1,
  },
  {
    id: "pallet_player_house_2f",
    layout: "PalletTown_PlayersHouse_2F",
    width: 12,
    height: 9,
    primary: building,
    secondary: house1,
    extras: { cells: [[10, 2, "."]] },
  },
  {
    id: "pallet_rival_house_1f",
    layout: "PalletTown_RivalsHouse",
    width: 13,
    height: 10,
    primary: building,
    secondary: house2,
  },
  {
    id: "pallet_oak_lab",
    layout: "PalletTown_ProfessorOaksLab",
    width: 13,
    height: 14,
    primary: building,
    secondary: labTs,
  },
  {
    id: "viridian_forest",
    layout: "ViridianForest",
    width: 54,
    height: 69,
    primary: general,
    secondary: viridianForestTs,
    extras: {
      cells: [
        [28, 61, "."],
        [29, 61, "."],
        [30, 61, "."],
        [28, 62, "."],
        [29, 62, "."],
        [30, 62, "."],
      ],
    },
  },
];

const renderedMaps = maps.map((spec) => renderMap(spec));
const collision = {};
mkdirSync(outRoot, { recursive: true });

for (const rendered of renderedMaps) {
  const dir = join(outRoot, rendered.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "ground.png"), rendered.groundPng);
  writeFileSync(join(dir, "overlay.png"), rendered.overlayPng);
  collision[rendered.id] = {
    width: rendered.width,
    height: rendered.height,
    rows: rendered.rows,
    grassRows: rendered.grassRows,
  };
  console.log("wrote", rendered.id, rendered.width, "x", rendered.height);
}

const collisionJson = `${JSON.stringify(collision, null, 2)}\n`;
writeFileSync(join(pokePC, "src", "world", "palletCollision.json"), collisionJson);
writeFileSync(join(pokePC, "server", "maps", "palletCollision.json"), collisionJson);
console.log("collision json updated");
