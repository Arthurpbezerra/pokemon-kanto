import type {
  Direction,
  EncounterZone,
  OverworldMapDef,
  Rect,
  TilePosition,
  TileTrigger,
  Warp,
} from "./tileWorld";
import collision from "./palletCollision.json";
import { publicUrl } from "../publicUrl";

const TILE_SIZE = 16;

function frMap(id: string) {
  return {
    mapImageUrl: publicUrl(`assets/pokefirered/maps/${id}/ground.png`),
    overlayImageUrl: publicUrl(`assets/pokefirered/maps/${id}/overlay.png`),
  };
}

export type MapNpc = {
  id: string;
  mapId: string;
  x: number;
  y: number;
  spriteKey: string;
  name: string;
  facing?: Direction;
  text: string;
  heal?: boolean;
};

function collisionFor(id: keyof typeof collision) {
  return collision[id];
}

/** Pallet Town maps baked from pret tilesets (ground + roof overlay). */
export const PALLET_MAPS: Record<string, OverworldMapDef> = {
  pallet_town: {
    id: "pallet_town",
    locationName: "Pallet Town",
    ...frMap("pallet_town"),
    widthTiles: 24,
    heightTiles: 20,
    tileSize: TILE_SIZE,
    spawn: { x: 6, y: 8 },
    blockedRects: [],
    collisionRows: collisionFor("pallet_town").rows,
    encounterZones: [],
    warps: [
      { x: 6, y: 7, w: 1, h: 1, toMapId: "pallet_player_house_1f", toX: 5, toY: 8, toLocation: "Pallet Town" },
      { x: 15, y: 7, w: 1, h: 1, toMapId: "pallet_rival_house_1f", toX: 5, toY: 8, toLocation: "Pallet Town" },
      { x: 16, y: 13, w: 1, h: 1, toMapId: "pallet_oak_lab", toX: 6, toY: 12, toLocation: "Pallet Town" },
    ],
    triggers: [],
  },
  pallet_player_house_1f: {
    id: "pallet_player_house_1f",
    locationName: "Pallet Town",
    ...frMap("pallet_player_house_1f"),
    widthTiles: 13,
    heightTiles: 10,
    tileSize: TILE_SIZE,
    spawn: { x: 5, y: 8 },
    blockedRects: [],
    collisionRows: collisionFor("pallet_player_house_1f").rows,
    encounterZones: [],
    warps: [
      { x: 4, y: 8, w: 2, h: 1, toMapId: "pallet_town", toX: 6, toY: 8, toLocation: "Pallet Town" },
      { x: 10, y: 2, w: 1, h: 1, toMapId: "pallet_player_house_2f", toX: 10, toY: 3, toLocation: "Pallet Town" },
    ],
    triggers: [],
  },
  pallet_player_house_2f: {
    id: "pallet_player_house_2f",
    locationName: "Pallet Town",
    ...frMap("pallet_player_house_2f"),
    widthTiles: 12,
    heightTiles: 9,
    tileSize: TILE_SIZE,
    spawn: { x: 10, y: 3 },
    blockedRects: [],
    collisionRows: collisionFor("pallet_player_house_2f").rows,
    encounterZones: [],
    warps: [{ x: 10, y: 2, w: 1, h: 1, toMapId: "pallet_player_house_1f", toX: 10, toY: 3, toLocation: "Pallet Town" }],
    triggers: [],
  },
  pallet_rival_house_1f: {
    id: "pallet_rival_house_1f",
    locationName: "Pallet Town",
    ...frMap("pallet_rival_house_1f"),
    widthTiles: 13,
    heightTiles: 10,
    tileSize: TILE_SIZE,
    spawn: { x: 5, y: 8 },
    blockedRects: [],
    collisionRows: collisionFor("pallet_rival_house_1f").rows,
    encounterZones: [],
    warps: [{ x: 3, y: 8, w: 3, h: 1, toMapId: "pallet_town", toX: 15, toY: 8, toLocation: "Pallet Town" }],
    triggers: [],
  },
  pallet_oak_lab: {
    id: "pallet_oak_lab",
    locationName: "Pallet Town",
    ...frMap("pallet_oak_lab"),
    widthTiles: 13,
    heightTiles: 14,
    tileSize: TILE_SIZE,
    spawn: { x: 6, y: 12 },
    blockedRects: [],
    collisionRows: collisionFor("pallet_oak_lab").rows,
    encounterZones: [],
    warps: [{ x: 5, y: 12, w: 3, h: 1, toMapId: "pallet_town", toX: 16, toY: 14, toLocation: "Pallet Town" }],
    triggers: [],
  },
};

export const PALLET_NPCS: MapNpc[] = [
  {
    id: "sign_lady",
    mapId: "pallet_town",
    x: 3,
    y: 10,
    spriteKey: "ow-woman",
    name: "Townsfolk",
    facing: "down",
    text: "I'm raising Pokémon too. When they get strong, they can even help you.",
  },
  {
    id: "fat_man",
    mapId: "pallet_town",
    x: 13,
    y: 17,
    spriteKey: "ow-fat-man",
    name: "Townsfolk",
    facing: "left",
    text: "Technology is incredible! You can now store and recall items and Pokémon via PC.",
  },
  {
    id: "mom",
    mapId: "pallet_player_house_1f",
    x: 8,
    y: 4,
    spriteKey: "ow-mom",
    name: "Mom",
    facing: "down",
    text: "Mom: Take care, honey! I'll heal your Pokémon whenever you come home.",
    heal: true,
  },
  {
    id: "daisy",
    mapId: "pallet_rival_house_1f",
    x: 10,
    y: 6,
    spriteKey: "ow-daisy",
    name: "Daisy",
    facing: "down",
    text: "Daisy: My brother is the Gym Leader's rival. He can be a handful!",
  },
  {
    id: "oak",
    mapId: "pallet_oak_lab",
    x: 6,
    y: 3,
    spriteKey: "ow-oak",
    name: "Prof. Oak",
    facing: "down",
    text: "Oak: This is my lab. Raise your Pokémon well — and say hello if you see other trainers in town!",
  },
];

export const DEFAULT_SPAWN: TilePosition = { mapId: "pallet_town", x: 6, y: 8 };

export const PLAYER_SPRITE_PRESETS = [
  {
    id: "red",
    label: "Red",
    sheetUrl: publicUrl("assets/pokefirered/overworld/red_normal.png"),
    frameCols: 9,
    frameRows: 1,
    renderScale: 1,
  },
  {
    id: "leaf",
    label: "Leaf",
    sheetUrl: publicUrl("assets/pokefirered/overworld/green_normal.png"),
    frameCols: 9,
    frameRows: 1,
    renderScale: 1,
  },
];

export function canonicalMapId(mapId?: string | null): string {
  if (!mapId) return "pallet_town";
  if (mapId === "kanto-overworld" || mapId === "pallet_rival_house_2f") {
    return "pallet_town";
  }
  return PALLET_MAPS[mapId] ? mapId : "pallet_town";
}

export function getPalletMap(mapId?: string | null): OverworldMapDef {
  return PALLET_MAPS[canonicalMapId(mapId)];
}

export function isPlayableMapId(mapId?: string | null): boolean {
  if (!mapId) return false;
  return Boolean(PALLET_MAPS[canonicalMapId(mapId)]);
}

export function rectsContain(rects: Rect[], x: number, y: number): boolean {
  return rects.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

export function isBlockedTile(map: OverworldMapDef, x: number, y: number, extraBlocked: { x: number; y: number }[] = []): boolean {
  if (x < 0 || y < 0 || x >= map.widthTiles || y >= map.heightTiles) return true;
  if (map.collisionRows?.[y]?.[x] === "#") return true;
  if (rectsContain(map.blockedRects ?? [], x, y)) return true;
  return extraBlocked.some((p) => p.x === x && p.y === y);
}

export function getWarpAt(map: OverworldMapDef, x: number, y: number): Warp | null {
  return (
    map.warps.find((w) => {
      const ww = w.w ?? 1;
      const hh = w.h ?? 1;
      return x >= w.x && x < w.x + ww && y >= w.y && y < w.y + hh;
    }) ?? null
  );
}

export function getTriggerAt(map: OverworldMapDef, x: number, y: number): TileTrigger | null {
  return map.triggers.find((t) => t.x === x && t.y === y) ?? null;
}

export function getEncounterZone(map: OverworldMapDef, x: number, y: number): EncounterZone | null {
  return (
    map.encounterZones.find((z) => x >= z.area.x && x < z.area.x + z.area.w && y >= z.area.y && y < z.area.y + z.area.h) ??
    null
  );
}

export function npcsOnMap(mapId: string): MapNpc[] {
  return PALLET_NPCS.filter((n) => n.mapId === mapId);
}

export function npcAt(mapId: string, x: number, y: number): MapNpc | null {
  return PALLET_NPCS.find((n) => n.mapId === mapId && n.x === x && n.y === y) ?? null;
}

export function facingTile(pos: TilePosition, facing: Direction): { x: number; y: number } {
  if (facing === "up") return { x: pos.x, y: pos.y - 1 };
  if (facing === "down") return { x: pos.x, y: pos.y + 1 };
  if (facing === "left") return { x: pos.x - 1, y: pos.y };
  return { x: pos.x + 1, y: pos.y };
}

export function manhattan(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function canInteractPlayers(
  from: { tilePos?: TilePosition | null; facing?: Direction },
  to: { tilePos?: TilePosition | null }
): boolean {
  const a = from.tilePos;
  const b = to.tilePos;
  if (!a || !b) return false;
  if (canonicalMapId(a.mapId) !== canonicalMapId(b.mapId) || a.mapId !== b.mapId) return false;
  const dist = manhattan(a, b);
  if (dist === 0) return false;
  if (dist > 1) return false;
  const face = facingTile(a, from.facing ?? "down");
  return face.x === b.x && face.y === b.y;
}
