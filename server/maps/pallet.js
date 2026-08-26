import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const TILE = 16;
const collision = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "palletCollision.json"), "utf8"));

export const PALLET_MAPS = {
  pallet_town: {
    id: "pallet_town",
    widthTiles: 24,
    heightTiles: 20,
    spawn: { x: 6, y: 8 },
    collisionRows: collision.pallet_town.rows,
    warps: [
      { x: 6, y: 7, w: 1, h: 1, toMapId: "pallet_player_house_1f", toX: 4, toY: 8 },
      { x: 15, y: 7, w: 1, h: 1, toMapId: "pallet_rival_house_1f", toX: 4, toY: 8 },
      { x: 16, y: 13, w: 1, h: 1, toMapId: "pallet_oak_lab", toX: 6, toY: 12 },
      { x: 10, y: 14, w: 1, h: 1, toMapId: "viridian_forest", toX: 29, toY: 60 },
    ],
  },
  pallet_player_house_1f: {
    id: "pallet_player_house_1f",
    widthTiles: 13,
    heightTiles: 10,
    spawn: { x: 4, y: 8 },
    collisionRows: collision.pallet_player_house_1f.rows,
    warps: [
      { x: 4, y: 8, w: 2, h: 1, toMapId: "pallet_town", toX: 6, toY: 8 },
      { x: 10, y: 2, w: 1, h: 1, toMapId: "pallet_player_house_2f", toX: 10, toY: 3 },
    ],
  },
  pallet_player_house_2f: {
    id: "pallet_player_house_2f",
    widthTiles: 12,
    heightTiles: 9,
    spawn: { x: 10, y: 3 },
    collisionRows: collision.pallet_player_house_2f.rows,
    warps: [{ x: 10, y: 2, w: 1, h: 1, toMapId: "pallet_player_house_1f", toX: 10, toY: 3 }],
  },
  pallet_rival_house_1f: {
    id: "pallet_rival_house_1f",
    widthTiles: 13,
    heightTiles: 10,
    spawn: { x: 4, y: 8 },
    collisionRows: collision.pallet_rival_house_1f.rows,
    warps: [{ x: 3, y: 8, w: 3, h: 1, toMapId: "pallet_town", toX: 15, toY: 8 }],
  },
  pallet_oak_lab: {
    id: "pallet_oak_lab",
    widthTiles: 13,
    heightTiles: 14,
    spawn: { x: 6, y: 12 },
    collisionRows: collision.pallet_oak_lab.rows,
    warps: [{ x: 5, y: 12, w: 3, h: 1, toMapId: "pallet_town", toX: 16, toY: 14 }],
  },
  viridian_forest: {
    id: "viridian_forest",
    widthTiles: 54,
    heightTiles: 69,
    spawn: { x: 29, y: 60 },
    collisionRows: collision.viridian_forest.rows,
    warps: [{ x: 29, y: 61, w: 1, h: 1, toMapId: "pallet_town", toX: 10, toY: 15 }],
  },
};

const NPC_TILES = [
  { mapId: "pallet_town", x: 3, y: 10 },
  { mapId: "pallet_town", x: 13, y: 17 },
  { mapId: "pallet_player_house_1f", x: 8, y: 4 },
  { mapId: "pallet_rival_house_1f", x: 10, y: 6 },
  { mapId: "pallet_oak_lab", x: 6, y: 3 },
];

export const DEFAULT_SPAWN = { mapId: "pallet_town", x: 6, y: 8 };

export function canonicalMapId(mapId) {
  if (!mapId) return "pallet_town";
  if (mapId === "kanto-overworld" || mapId === "pallet_rival_house_2f") {
    return "pallet_town";
  }
  return PALLET_MAPS[mapId] ? mapId : "pallet_town";
}

export function getMap(mapId) {
  return PALLET_MAPS[canonicalMapId(mapId)];
}

function inRect(r, x, y) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

export function isBlocked(mapId, x, y) {
  const map = getMap(mapId);
  if (!map) return true;
  if (x < 0 || y < 0 || x >= map.widthTiles || y >= map.heightTiles) return true;
  if (map.collisionRows?.[y]?.[x] === "#") return true;
  if (map.blockedRects?.some((r) => inRect(r, x, y))) return true;
  return NPC_TILES.some((n) => n.mapId === map.id && n.x === x && n.y === y);
}

export function getWarp(mapId, x, y) {
  const map = getMap(mapId);
  if (!map) return null;
  return (
    map.warps.find((w) => {
      const ww = w.w ?? 1;
      const hh = w.h ?? 1;
      return x >= w.x && x < w.x + ww && y >= w.y && y < w.y + hh;
    }) ?? null
  );
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isSameTile(a, b) {
  return a && b && a.mapId === b.mapId && a.x === b.x && a.y === b.y;
}

export function findOpenTile(mapId, preferred, occupied = []) {
  const id = canonicalMapId(mapId);
  const px = preferred?.x ?? 6;
  const py = preferred?.y ?? 8;
  const tries = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
    [2, 0],
    [-2, 0],
    [0, 2],
  ];
  for (const [dx, dy] of tries) {
    const x = px + dx;
    const y = py + dy;
    if (isBlocked(id, x, y)) continue;
    if (occupied.some((p) => p.mapId === id && p.x === x && p.y === y)) continue;
    return { mapId: id, x, y };
  }
  return { mapId: id, x: px, y: py };
}

export function isLegalMove(from, to, occupied = []) {
  if (!from || !to) return false;
  const fromId = canonicalMapId(from.mapId);
  const toId = canonicalMapId(to.mapId);
  const dest = { mapId: toId, x: Math.round(to.x), y: Math.round(to.y) };
  const src = { mapId: fromId, x: Math.round(from.x), y: Math.round(from.y) };

  if (isSameTile(src, dest)) return true;

  const warp = getWarp(src.mapId, src.x, src.y);
  if (warp && warp.toMapId === dest.mapId) {
    const open = findOpenTile(dest.mapId, { x: warp.toX, y: warp.toY }, occupied);
    return dest.x === open.x && dest.y === open.y;
  }

  if (src.mapId !== dest.mapId) {
    const map = getMap(src.mapId);
    if (!map) return false;
    for (const w of map.warps) {
      if (w.toMapId !== dest.mapId) continue;
      const door = { mapId: src.mapId, x: w.x, y: w.y };
      if (manhattan(src, door) !== 1) continue;
      const open = findOpenTile(dest.mapId, { x: w.toX, y: w.toY }, occupied);
      if (dest.x === open.x && dest.y === open.y) return true;
    }
    return false;
  }

  if (manhattan(src, dest) !== 1) return false;
  if (isBlocked(dest.mapId, dest.x, dest.y)) return false;
  if (occupied.some((p) => p.mapId === dest.mapId && p.x === dest.x && p.y === dest.y)) return false;
  return true;
}

export function isLegalWarp(from, via, to, occupied = []) {
  if (!from || !via || !to) return false;
  const src = { mapId: canonicalMapId(from.mapId), x: Math.round(from.x), y: Math.round(from.y) };
  const door = { mapId: canonicalMapId(via.mapId), x: Math.round(via.x), y: Math.round(via.y) };
  const dest = { mapId: canonicalMapId(to.mapId), x: Math.round(to.x), y: Math.round(to.y) };
  if (src.mapId !== door.mapId) return false;
  if (!isSameTile(src, door)) {
    if (manhattan(src, door) !== 1) return false;
    if (isBlocked(door.mapId, door.x, door.y)) return false;
    if (occupied.some((p) => p.mapId === door.mapId && p.x === door.x && p.y === door.y)) return false;
  }
  const warp = getWarp(door.mapId, door.x, door.y);
  if (!warp || warp.toMapId !== dest.mapId) return false;
  const open = findOpenTile(dest.mapId, { x: warp.toX, y: warp.toY }, occupied);
  return dest.x === open.x && dest.y === open.y;
}

export function canInteract(aPos, aFacing, bPos) {
  if (!aPos || !bPos) return false;
  if (canonicalMapId(aPos.mapId) !== canonicalMapId(bPos.mapId) || aPos.mapId !== bPos.mapId) return false;
  const dist = manhattan(aPos, bPos);
  if (dist !== 1) return false;
  let fx = aPos.x;
  let fy = aPos.y;
  if (aFacing === "up") fy -= 1;
  else if (aFacing === "down") fy += 1;
  else if (aFacing === "left") fx -= 1;
  else fx += 1;
  return fx === bPos.x && fy === bPos.y;
}

export { TILE };
