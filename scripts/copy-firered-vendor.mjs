/**
 * Copy the minimal pokefirered slice into vendor/pokefirered/.
 * Run once locally when refreshing source assets from pret.
 */
import { cpSync, existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pokePC = join(dirname(fileURLToPath(import.meta.url)), "..");
const pret = join(pokePC, "..", "pokefirered");
const vendor = join(pokePC, "vendor", "pokefirered");

const layouts = [
  "PalletTown",
  "PalletTown_PlayersHouse_1F",
  "PalletTown_PlayersHouse_2F",
  "PalletTown_RivalsHouse",
  "PalletTown_ProfessorOaksLab",
  "ViridianForest",
];

const tilesets = [
  ["primary", "general"],
  ["primary", "building"],
  ["secondary", "pallet_town"],
  ["secondary", "generic_building_1"],
  ["secondary", "generic_building_2"],
  ["secondary", "lab"],
  ["secondary", "viridian_forest"],
];

const maps = [
  "PalletTown",
  "PalletTown_PlayersHouse_1F",
  "PalletTown_PlayersHouse_2F",
  "PalletTown_RivalsHouse",
  "PalletTown_ProfessorOaksLab",
  "ViridianForest",
];

const sprites = [
  "red_normal",
  "green_normal",
  "prof_oak",
  "woman_1",
  "fat_man",
  "mom",
  "daisy",
  "blue",
  "fisher",
];

function mustCopy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Missing source file: ${from}`);
  }
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
}

if (!existsSync(pret)) {
  throw new Error(`pokefirered not found at ${pret}`);
}

for (const layout of layouts) {
  mustCopy(
    join(pret, "data", "layouts", layout, "map.bin"),
    join(vendor, "data", "layouts", layout, "map.bin")
  );
}

for (const [kind, name] of tilesets) {
  const base = join(pret, "data", "tilesets", kind, name);
  const out = join(vendor, "data", "tilesets", kind, name);
  mustCopy(join(base, "tiles.4bpp"), join(out, "tiles.4bpp"));
  mustCopy(join(base, "metatiles.bin"), join(out, "metatiles.bin"));
  mustCopy(join(base, "metatile_attributes.bin"), join(out, "metatile_attributes.bin"));
  for (let i = 0; i < 16; i++) {
    const pal = `${String(i).padStart(2, "0")}.pal`;
    mustCopy(join(base, "palettes", pal), join(out, "palettes", pal));
  }
}

for (const map of maps) {
  mustCopy(join(pret, "data", "maps", map, "map.json"), join(vendor, "data", "maps", map, "map.json"));
}

for (const sprite of sprites) {
  const from = join(pret, "graphics", "object_events", "pics", "people", `${sprite}.png`);
  const to = join(vendor, "object_events", "pics", "people", `${sprite}.png`);
  if (existsSync(from)) {
    mustCopy(from, to);
  } else {
    console.warn(`sprite missing in pret, skipping: ${from}`);
  }
}

console.log("vendor/pokefirered updated");
