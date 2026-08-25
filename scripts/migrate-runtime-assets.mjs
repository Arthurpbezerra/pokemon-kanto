/**
 * Copy runtime FireRed assets into public/assets/pokefirered/.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pokePC = join(dirname(fileURLToPath(import.meta.url)), "..");
const legacyOw = join(pokePC, "public", "assets", "fr", "ow");
const runtimeOw = join(pokePC, "public", "assets", "pokefirered", "overworld");
const legacyMaps = join(pokePC, "public", "assets", "fr", "maps");
const runtimeMaps = join(pokePC, "public", "assets", "pokefirered", "maps");

mkdirSync(runtimeOw, { recursive: true });

if (existsSync(legacyOw)) {
  for (const file of readdirSync(legacyOw)) {
    if (file.endsWith(".png")) {
      cpSync(join(legacyOw, file), join(runtimeOw, file), { force: true });
    }
  }
}

if (existsSync(legacyMaps) && !existsSync(runtimeMaps)) {
  cpSync(legacyMaps, runtimeMaps, { recursive: true, force: true });
}

console.log("runtime assets migrated to public/assets/pokefirered/");
