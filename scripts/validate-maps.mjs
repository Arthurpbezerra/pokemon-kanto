/**
 * Validate baked FireRed map outputs and registry parity.
 */
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const pokePC = join(dirname(fileURLToPath(import.meta.url)), "..");
const mapRoot = join(pokePC, "public", "assets", "pokefirered", "maps");
const collisionClient = join(pokePC, "src", "world", "palletCollision.json");
const collisionServer = join(pokePC, "server", "maps", "palletCollision.json");

const MAPS = [
  { id: "pallet_town", width: 24, height: 20 },
  { id: "pallet_player_house_1f", width: 13, height: 10 },
  { id: "pallet_player_house_2f", width: 12, height: 9 },
  { id: "pallet_rival_house_1f", width: 13, height: 10 },
  { id: "pallet_oak_lab", width: 13, height: 14 },
  { id: "viridian_forest", width: 54, height: 69 },
];

function fail(message) {
  throw new Error(`[validate-maps] ${message}`);
}

function readPngSize(path) {
  const buf = readFileSync(path);
  if (buf.length < 24 || buf[0] !== 0x89) fail(`${path} is not a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function hash(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const map of MAPS) {
  const ground = join(mapRoot, map.id, "ground.png");
  const overlay = join(mapRoot, map.id, "overlay.png");
  if (!existsSync(ground)) fail(`missing ${ground}`);
  if (!existsSync(overlay)) fail(`missing ${overlay}`);
  for (const [label, path] of [
    ["ground", ground],
    ["overlay", overlay],
  ]) {
    const size = readPngSize(path);
    const expectedW = map.width * 16;
    const expectedH = map.height * 16;
    if (size.width !== expectedW || size.height !== expectedH) {
      fail(`${map.id}/${label}.png is ${size.width}x${size.height}, expected ${expectedW}x${expectedH}`);
    }
  }
}

const clientCollision = JSON.parse(readFileSync(collisionClient, "utf8"));
const serverCollision = JSON.parse(readFileSync(collisionServer, "utf8"));
if (hash(collisionClient) !== hash(collisionServer)) {
  fail("client and server collision JSON differ");
}

for (const map of MAPS) {
  const entry = clientCollision[map.id];
  if (!entry) fail(`collision missing key ${map.id}`);
  if (entry.width !== map.width || entry.height !== map.height) {
    fail(`${map.id} collision dims ${entry.width}x${entry.height} != ${map.width}x${map.height}`);
  }
  if (entry.rows.length !== map.height) fail(`${map.id} collision row count mismatch`);
  for (const row of entry.rows) {
    if (row.length !== map.width) fail(`${map.id} collision row width mismatch`);
    if (!/^[.#]+$/.test(row)) fail(`${map.id} collision row has invalid characters`);
  }
}

console.log("validate-maps: ok");
