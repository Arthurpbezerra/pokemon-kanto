import {
  DEFAULT_SPAWN,
  PALLET_MAPS,
  PLAYER_SPRITE_PRESETS,
  canonicalMapId,
  getEncounterZone,
  getPalletMap,
  getTriggerAt,
  getWarpAt,
  isBlockedTile,
  isPlayableMapId,
} from "./palletMaps";

export type Direction = "up" | "down" | "left" | "right";

export type TilePosition = {
  mapId: string;
  x: number;
  y: number;
};

export type LocationPoint = {
  x: number;
  y: number;
};

export type Rect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type Warp = {
  x: number;
  y: number;
  w?: number;
  h?: number;
  toMapId: string;
  toX: number;
  toY: number;
  toLocation: string;
};

export type TileTrigger = {
  x: number;
  y: number;
  type: "cityStay" | "gymEntry";
  location: string;
};

export type EncounterZone = {
  kind: "grass";
  area: Rect;
  chanceBase: number;
};

export type PlayerSpritePreset = {
  id: string;
  label: string;
  sheetUrl: string;
  frameCols: number;
  frameRows: number;
  renderScale?: number;
};

export type OverworldMapDef = {
  id: string;
  locationName: string;
  mapImageUrl: string;
  overlayImageUrl?: string;
  tiledMapUrl?: string;
  sourceRect?: Rect;
  widthTiles: number;
  heightTiles: number;
  tileSize: number;
  spawn: { x: number; y: number };
  blockedRects: Rect[];
  collisionRows?: string[];
  encounterZones: EncounterZone[];
  warps: Warp[];
  triggers: TileTrigger[];
  pointsOfInterest?: { label: string; x: number; y: number }[];
};

export { PLAYER_SPRITE_PRESETS, DEFAULT_SPAWN, canonicalMapId, getEncounterZone, getTriggerAt, getWarpAt };

export const LOCATION_TO_MAP_ID: Record<string, string> = {
  "Pallet Town": "pallet_town",
};

export const MAP_ID_TO_LOCATION: Record<string, string> = Object.fromEntries(
  Object.values(PALLET_MAPS).map((m) => [m.id, m.locationName])
);

export function getMapForLocation(_location: string): OverworldMapDef {
  return getPalletMap("pallet_town");
}

export function getMapById(mapId: string): OverworldMapDef {
  return getPalletMap(mapId);
}

export function hasMapId(mapId?: string | null): boolean {
  return isPlayableMapId(mapId) || Boolean(mapId && PALLET_MAPS[canonicalMapId(mapId)]);
}

export function clampTile(pos: TilePosition): TilePosition {
  const map = getMapById(pos.mapId);
  return {
    mapId: map.id,
    x: Math.max(0, Math.min(map.widthTiles - 1, Math.round(pos.x))),
    y: Math.max(0, Math.min(map.heightTiles - 1, Math.round(pos.y))),
  };
}

export function toTilePosition(_location: string, _point?: LocationPoint): TilePosition {
  return { ...DEFAULT_SPAWN };
}

export function tileDistance(a?: TilePosition | null, b?: TilePosition | null): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  if (a.mapId !== b.mapId) return Number.POSITIVE_INFINITY;
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isMapBlocked(map: OverworldMapDef, x: number, y: number): boolean {
  return isBlockedTile(map, x, y);
}

export function pickDirectionalConnection(
  current: string,
  connections: string[],
  points: Record<string, LocationPoint>,
  direction: Direction
): string | null {
  const from = points[current];
  if (!from || connections.length === 0) return null;
  const candidates = connections
    .map((name) => ({ name, point: points[name] }))
    .filter((entry): entry is { name: string; point: LocationPoint } => Boolean(entry.point))
    .filter(({ point }) => {
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      if (direction === "up") return dy < 0;
      if (direction === "down") return dy > 0;
      if (direction === "left") return dx < 0;
      return dx > 0;
    })
    .map(({ name, point }) => {
      const dx = point.x - from.x;
      const dy = point.y - from.y;
      const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
      const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
      return { name, primary, secondary };
    })
    .sort((a, b) => a.secondary - b.secondary || a.primary - b.primary);
  return candidates.length > 0 ? candidates[0].name : null;
}
