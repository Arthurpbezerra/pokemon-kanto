import React, { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { getPokemonTemplate, getStarters, makeInstanceFromTemplate, getMovesForLevel, getMovesLearnedAtLevel, getNextEvolution, prefetchPokemonTemplates, xpToNextForLevel } from "./api/pokeapi";
import * as sound from "./audio/sound";
import BottomNav from "./components/BottomNav";
import TeamPanel from "./components/TeamPanel";
import LearnMoveModal from "./components/LearnMoveModal";
import BattleModal from "./components/BattleModal";
import CityModal from "./components/CityModal";
import AchievementToast, { type AchievementData } from "./components/AchievementToast";
import KantoMapView from "./components/KantoMapView";
import SecretGigiEvent, { clearGigiEventStorage } from "./components/SecretGigiEvent";
import PalletMapScreen from "./components/PalletMapScreen";
import { isSecretGigiName, EEVEE_ID } from "./secret-gigi.config";
import {
  PLAYER_SPRITE_PRESETS,
  DEFAULT_SPAWN,
  getMapById,
  getMapForLocation,
  hasMapId,
  pickDirectionalConnection,
  toTilePosition,
  type Direction,
  type TilePosition,
} from "./world/tileWorld";
import { canInteractPlayers } from "./world/palletMaps";

const WS_URL = (import.meta.env.VITE_WS_URL && String(import.meta.env.VITE_WS_URL).trim()) || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
const SOLO_SAVE_KEY = "pokemon-kanto-solo";
/** Must match server/index.js COLORS / MAX_PLAYERS */
const ROOM_PLAYER_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#22c55e",
  "#eab308",
  "#a855f7",
  "#f97316",
  "#14b8a6",
  "#ec4899",
  "#84cc16",
  "#06b6d4",
];
const MAX_ROOM_PLAYERS = 10;

type Pokemon = {
  id: number;
  name: string;
  sprite: string;
  level: number;
  hp: number;
  maxHp: number;
  types?: string[];
  stats?: { attack: number; defense: number; speed: number };
  xp?: number;
  xpToNext?: number;
  moves?: string[];
  isStarter?: boolean;
  isFainted?: boolean;
  isShiny?: boolean;
};

export type PlayerScreen = "lobby" | "sprite" | "starter" | "map";

const MAX_TEAM_SIZE = 6;
const INITIAL_POKEBALLS = 10;
const INITIAL_COINS = 10;
const POKEBALL_PRICE = 1;
const GREAT_BALL_PRICE = 3;
const ULTRA_BALL_PRICE = 5;
const POTION_PRICE = 2;
const SUPER_POTION_PRICE = 4;
const REPEL_PRICE = 3;
const SHINY_CHANCE = 1 / 256;
const WILD_COIN_REWARD = 1;
const GYM_COIN_REWARD = 15;
const LEAGUE_COIN_REWARD = 30;

type Bag = {
  pokeball: number;
  greatball: number;
  ultraball: number;
  potion: number;
  superpotion: number;
  repel: number;
  coins: number;
};

const DEFAULT_BAG: Bag = { pokeball: INITIAL_POKEBALLS, greatball: 0, ultraball: 0, potion: 3, superpotion: 0, repel: 0, coins: INITIAL_COINS };

function normalizeBag(bag: any): Bag {
  if (!bag) return { ...DEFAULT_BAG };
  return {
    pokeball: bag.pokeball ?? INITIAL_POKEBALLS,
    greatball: bag.greatball ?? 0,
    ultraball: bag.ultraball ?? 0,
    potion: bag.potion ?? 0,
    superpotion: bag.superpotion ?? 0,
    repel: bag.repel ?? 0,
    coins: bag.coins ?? INITIAL_COINS,
  };
}

function normalizePlayer(player: Player): Player {
  const location = player.location || "Pallet Town";
  const normalizedTilePos =
    player.tilePos && hasMapId(player.tilePos.mapId)
      ? { ...player.tilePos, mapId: getMapById(player.tilePos.mapId).id }
      : { ...DEFAULT_SPAWN };
  return {
    ...player,
    location,
    bag: normalizeBag(player.bag),
    tilePos: normalizedTilePos,
    spriteId: PLAYER_SPRITE_PRESETS.some((preset) => preset.id === player.spriteId)
      ? player.spriteId
      : PLAYER_SPRITE_PRESETS[0].id,
    facing: player.facing ?? "down",
    moving: player.moving ?? false,
    lastTown:
      player.lastTown || "Pallet Town",
  };
}

type Player = {
  id: string;
  name: string;
  color: string;
  isHost?: boolean;
  isReady?: boolean;
  screen?: PlayerScreen;
  location: string;
  tilePos?: TilePosition;
  spriteId?: string;
  facing?: Direction;
  moving?: boolean;
  /** Monotonic seq from server playerMoved; ignore out-of-order deltas. */
  moveSeq?: number;
  lastTown?: string;
  team: Pokemon[];
  badges: string[];
  bag?: Bag;
  pokedex?: { seen: number[]; caught: number[] };
  /** When true, Pokémon that didn't fight get 50% of battle XP (Exp Share). Default true. */
  expShare?: boolean;
  wildEncounter?: null | { pokemon: Pokemon; location: string; triggeredByPlayerId?: string };
  encounterLog?: string[];
  pendingLearn?: null | { playerIndex: number; pokemonIndex: number; newMove: string; newLevel: number; remainingMoves?: string[] };
  evolutionNotice?: null | { playerIndex: number; oldName: string; newName: string };
};

type Phase = "home" | "lobby" | "starter" | "map" | "encounter" | "battle";

const generateCode = () =>
  Math.random().toString(36).slice(2, 8).toUpperCase();

export type PvpRequest = { fromPlayerId: string; toPlayerId: string; type: "battle" | "trade" };
export type PvpBattle = {
  challengerId: string;
  defenderId: string;
  challengerHp?: number;
  defenderHp?: number;
  challengerMaxHp?: number;
  defenderMaxHp?: number;
  challengerIndex?: number;
  defenderIndex?: number;
  mustSwitch?: "challenger" | "defender" | null;
  log?: string[];
  status?: "waiting_moves" | "resolving" | "ended" | "waiting_switch";
  challengerMove?: string | { kind: string; moveName?: string; index?: number } | null;
  defenderMove?: string | { kind: string; moveName?: string; index?: number } | null;
  winner?: "challenger" | "defender" | null;
};
export type PvpTrade = { playerAId: string; playerBId: string; aSelectedIndex: number | null; bSelectedIndex: number | null };

export type GameStateSnapshot = {
  phase: Phase;
  roomCode: string;
  players: Player[];
  currentPlayerIndex: number;
  wildEncounter: null | { pokemon: Pokemon; location: string; triggeredByPlayerId?: string };
  encounterLog: string[];
  pendingLearn: null | { playerIndex: number; pokemonIndex: number; newMove: string; newLevel: number; remainingMoves?: string[] };
  evolutionNotice: null | { playerIndex: number; oldName: string; newName: string };
  pvpRequest: PvpRequest | null;
  pvpBattle: PvpBattle | null;
  pvpTrade: PvpTrade | null;
  /** Set by server when state is from a stateUpdate; client uses it to avoid overwriting own identity with other client's view. */
  _fromSocketId?: string | null;
};

const STARTER_IDS = [1, 4, 7];

/** Ordem canônica dos 8 ginásios de Kanto (para contagem e Liga). */
const KANTO_GYM_LEADERS = ["Brock", "Misty", "Lt. Surge", "Erika", "Koga", "Sabrina", "Blaine", "Giovanni"] as const;
const BADGES_REQUIRED_FOR_LEAGUE = 8;

type LocationDef = {
  type: "town" | "grass" | "water" | "cave";
  connections: string[];
  wildPool?: number[];
  nightPool?: number[];
  minLevel?: number;
  maxLevel?: number;
  gym?: string | null;
  league?: boolean;
  x: number;
  y: number;
};

function isNightTime(): boolean {
  const h = new Date().getHours();
  return h < 6 || h >= 20;
}

function getWildPool(loc: LocationDef): number[] {
  if (isNightTime() && loc.nightPool && loc.nightPool.length > 0) return loc.nightPool;
  return loc.wildPool ?? [];
}

/** Níveis por local (progressão estilo R/B/Y). Sem min/max = fallback 3–7. */
const LOCATIONS: Record<string, LocationDef> = {
  "Pallet Town": { type: "town", connections: [], gym: null, x: 18, y: 70 },
  "Route 1": { type: "grass", connections: ["Pallet Town", "Viridian City"], wildPool: [16, 19], nightPool: [19, 41, 163], minLevel: 2, maxLevel: 5, gym: null, x: 18, y: 58 },
  "Viridian City": { type: "town", connections: ["Route 1", "Route 2", "Viridian Gym"], gym: null, x: 18, y: 44 },
  "Route 2": { type: "grass", connections: ["Viridian City", "Viridian Forest"], wildPool: [16, 19, 10, 13], nightPool: [19, 41, 10, 13], minLevel: 3, maxLevel: 6, gym: null, x: 26, y: 36 },
  "Viridian Forest": { type: "grass", connections: ["Route 2", "Pewter City"], wildPool: [10, 13, 11, 14, 16, 25], nightPool: [10, 11, 14, 41, 48], minLevel: 3, maxLevel: 6, gym: null, x: 32, y: 32 },
  "Pewter City": { type: "town", connections: ["Viridian Forest", "Mt. Moon"], gym: "Brock", x: 38, y: 28 },
  "Mt. Moon": { type: "cave", connections: ["Pewter City", "Route 4"], wildPool: [74, 41, 35, 46], nightPool: [41, 74, 35, 92], minLevel: 6, maxLevel: 11, gym: null, x: 44, y: 36 },
  "Route 4": { type: "grass", connections: ["Mt. Moon", "Cerulean City"], wildPool: [16, 21, 46], minLevel: 6, maxLevel: 10, gym: null, x: 52, y: 36 },
  "Cerulean City": { type: "town", connections: ["Route 4", "Route 24", "Route 5"], gym: "Misty", x: 62, y: 30 },
  "Route 24": { type: "grass", connections: ["Cerulean City", "Route 25"], wildPool: [43, 69, 16], minLevel: 6, maxLevel: 10, gym: null, x: 68, y: 28 },
  "Route 25": { type: "grass", connections: ["Route 24", "Bill's Sea Cottage"], wildPool: [43, 69, 25, 16], minLevel: 8, maxLevel: 12, gym: null, x: 74, y: 26 },
  "Bill's Sea Cottage": { type: "town", connections: ["Route 25"], gym: null, x: 78, y: 22 },
  "Vermilion City": { type: "town", connections: ["Route 5", "Route 6", "Route 11"], gym: "Lt. Surge", x: 78, y: 52 },
  "Route 11": { type: "grass", connections: ["Vermilion City", "Route 12"], wildPool: [16, 19, 96, 21], minLevel: 13, maxLevel: 17, gym: null, x: 82, y: 44 },
  "Route 12": { type: "grass", connections: ["Route 11", "Lavender Town"], wildPool: [16, 43, 69, 17], minLevel: 13, maxLevel: 17, gym: null, x: 86, y: 36 },
  "Lavender Town": { type: "town", connections: ["Route 12", "Route 10", "Route 7", "Route 8"], gym: null, x: 86, y: 26 },
  "Route 10": { type: "grass", connections: ["Lavender Town", "Cerulean City"], wildPool: [41, 81, 100], minLevel: 10, maxLevel: 14, gym: null, x: 74, y: 34 },
  "Route 7": { type: "grass", connections: ["Lavender Town", "Celadon City", "Saffron City"], wildPool: [43, 69, 16], minLevel: 8, maxLevel: 12, gym: null, x: 68, y: 44 },
  "Route 8": { type: "grass", connections: ["Lavender Town", "Celadon City", "Saffron City"], wildPool: [43, 69, 19, 96], minLevel: 8, maxLevel: 12, gym: null, x: 64, y: 50 },
  "Celadon City": { type: "town", connections: ["Route 7", "Route 9", "Route 16", "Saffron City"], gym: "Erika", x: 58, y: 50 },
  "Route 9": { type: "grass", connections: ["Celadon City", "Lavender Town"], wildPool: [43, 69, 21, 74], minLevel: 10, maxLevel: 14, gym: null, x: 66, y: 34 },
  "Route 16": { type: "grass", connections: ["Celadon City", "Route 17"], wildPool: [84, 111], minLevel: 18, maxLevel: 22, gym: null, x: 60, y: 58 },
  "Route 17": { type: "grass", connections: ["Route 16", "Route 18"], wildPool: [84, 111], minLevel: 20, maxLevel: 24, gym: null, x: 64, y: 64 },
  "Route 18": { type: "grass", connections: ["Route 17", "Fuchsia City"], wildPool: [84, 111, 16], minLevel: 22, maxLevel: 26, gym: null, x: 68, y: 74 },
  "Fuchsia City": { type: "town", connections: ["Route 18", "Route 19"], gym: "Koga", x: 72, y: 78 },
  "Route 19": { type: "water", connections: ["Fuchsia City", "Cinnabar Island"], wildPool: [129, 118, 72], minLevel: 15, maxLevel: 25, gym: null, x: 50, y: 86 },
  "Route 20": { type: "water", connections: ["Fuchsia City", "Cinnabar Island"], wildPool: [129, 118, 72, 87], minLevel: 20, maxLevel: 28, gym: null, x: 60, y: 86 },
  "Cinnabar Island": { type: "town", connections: ["Route 19", "Route 21"], gym: "Blaine", x: 30, y: 92 },
  "Route 21": { type: "grass", connections: ["Cinnabar Island", "Pallet Town"], wildPool: [16, 21, 74, 19], minLevel: 15, maxLevel: 28, gym: null, x: 22, y: 82 },
  "Route 13": { type: "grass", connections: ["Fuchsia City", "Route 14"], wildPool: [16, 17, 43, 69, 49], minLevel: 25, maxLevel: 29, gym: null, x: 68, y: 72 },
  "Route 14": { type: "grass", connections: ["Route 13", "Route 15"], wildPool: [16, 17, 43, 44, 69], minLevel: 25, maxLevel: 29, gym: null, x: 70, y: 68 },
  "Route 15": { type: "grass", connections: ["Route 14", "Lavender Town"], wildPool: [16, 17, 43, 69, 123], minLevel: 25, maxLevel: 29, gym: null, x: 74, y: 58 },
  "Saffron City": { type: "town", connections: ["Celadon City", "Route 5", "Route 6", "Route 7", "Route 8"], gym: "Sabrina", x: 66, y: 48 },
  "Route 5": { type: "grass", connections: ["Cerulean City", "Vermilion City", "Saffron City"], wildPool: [16, 43, 69], minLevel: 8, maxLevel: 12, gym: null, x: 68, y: 40 },
  "Route 6": { type: "grass", connections: ["Saffron City", "Vermilion City"], wildPool: [16, 19, 21], minLevel: 10, maxLevel: 14, gym: null, x: 72, y: 44 },
  "Viridian Gym": { type: "town", connections: ["Viridian City"], gym: "Giovanni", x: 18, y: 36 },
  "Indigo Plateau": { type: "town", connections: ["Viridian Gym"], gym: null, league: true, x: 28, y: 10 }
};

const LOCATION_POINTS: Record<string, { x: number; y: number }> = Object.fromEntries(
  Object.entries(LOCATIONS).map(([name, loc]) => [name, { x: loc.x, y: loc.y }])
);

function getWildLevel(loc: LocationDef | undefined): number {
  if (!loc) return 3 + Math.floor(Math.random() * 5);
  const min = loc.minLevel ?? 3;
  const max = loc.maxLevel ?? 7;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

const GYM_LEADER_SPRITES: Record<string, string> = {
  "Brock": "https://play.pokemonshowdown.com/sprites/trainers/gen1/brock.png",
  "Misty": "https://play.pokemonshowdown.com/sprites/trainers/gen1/misty.png",
  "Lt. Surge": "https://play.pokemonshowdown.com/sprites/trainers/gen1/surge.png",
  "Erika": "https://play.pokemonshowdown.com/sprites/trainers/gen1/erika.png",
  "Koga": "https://play.pokemonshowdown.com/sprites/trainers/gen1/koga.png",
  "Sabrina": "https://play.pokemonshowdown.com/sprites/trainers/gen1/sabrina.png",
  "Blaine": "https://play.pokemonshowdown.com/sprites/trainers/gen1/blaine.png",
  "Giovanni": "https://play.pokemonshowdown.com/sprites/trainers/gen1/giovanni.png",
  "Lorelei": "https://play.pokemonshowdown.com/sprites/trainers/gen1/lorelei.png",
  "Bruno": "https://play.pokemonshowdown.com/sprites/trainers/gen1/bruno.png",
  "Agatha": "https://play.pokemonshowdown.com/sprites/trainers/gen1/agatha.png",
  "Lance": "https://play.pokemonshowdown.com/sprites/trainers/gen1/lance.png",
  "Champion": "https://play.pokemonshowdown.com/sprites/trainers/gen1/blue.png"
};

/** Saídas de cidades com ginásio bloqueadas até derrotar o líder (exceto Giovanni/Viridian). */
const GYM_BLOCKED_EXITS: Record<string, string[]> = {
  "Pewter City": ["Mt. Moon"],
  "Cerulean City": ["Route 24", "Route 5"],
  "Vermilion City": ["Route 11", "Route 6"],
  "Celadon City": ["Route 9", "Route 16", "Saffron City"],
  "Saffron City": ["Route 5", "Route 6", "Route 7", "Route 8"],
  "Fuchsia City": ["Route 18", "Route 19"],
  "Cinnabar Island": ["Route 19", "Route 21"]
};

/** Rival/trainer battles on specific routes. Trigger once per location. */
const ROUTE_TRAINERS: Record<string, { name: string; sprite: string; team: { id: number; level: number }[] }> = {
  "Route 4":  { name: "Bug Catcher", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/bugcatcher.png", team: [{ id: 12, level: 10 }, { id: 15, level: 10 }] },
  "Route 9":  { name: "Hiker", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/hiker.png", team: [{ id: 74, level: 15 }, { id: 75, level: 17 }] },
  "Route 11": { name: "Gambler", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/gambler.png", team: [{ id: 100, level: 18 }, { id: 101, level: 20 }] },
  "Route 12": { name: "Fisher", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/fisher.png", team: [{ id: 129, level: 15 }, { id: 130, level: 22 }] },
  "Route 16": { name: "Biker", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/biker.png", team: [{ id: 109, level: 25 }, { id: 110, level: 28 }] },
  "Route 17": { name: "Cue Ball", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/biker.png", team: [{ id: 57, level: 28 }, { id: 62, level: 30 }] },
  "Route 13": { name: "Bird Keeper", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/birdkeeper.png", team: [{ id: 18, level: 29 }, { id: 22, level: 31 }] },
  "Route 15": { name: "Beauty", sprite: "https://play.pokemonshowdown.com/sprites/trainers/gen1/beauty.png", team: [{ id: 36, level: 28 }, { id: 40, level: 30 }] },
};

/** Elite Four + Champion para a Liga (Indigo Plateau). */
const LEAGUE_TRAINERS: { name: string; team: { id: number; level: number }[] }[] = [
  { name: "Lorelei", team: [{ id: 87, level: 54 }, { id: 91, level: 53 }, { id: 80, level: 54 }, { id: 124, level: 56 }, { id: 131, level: 56 }] },
  { name: "Bruno", team: [{ id: 95, level: 53 }, { id: 107, level: 55 }, { id: 106, level: 55 }, { id: 95, level: 56 }, { id: 68, level: 58 }] },
  { name: "Agatha", team: [{ id: 94, level: 56 }, { id: 42, level: 56 }, { id: 93, level: 55 }, { id: 110, level: 58 }, { id: 94, level: 60 }] },
  { name: "Lance", team: [{ id: 130, level: 58 }, { id: 148, level: 56 }, { id: 148, level: 56 }, { id: 142, level: 58 }, { id: 149, level: 62 }] },
  { name: "Champion", team: [{ id: 18, level: 61 }, { id: 65, level: 59 }, { id: 112, level: 61 }, { id: 130, level: 61 }, { id: 59, level: 63 }, { id: 3, level: 65 }] }
];

const LOCATION_TYPE_LABELS: Record<string, { icon: string; label: string; bg: string }> = {
  town: { icon: "🏠", label: "City", bg: "bg-amber-900/50" },
  grass: { icon: "🌿", label: "Route", bg: "bg-green-900/50" },
  water: { icon: "🌊", label: "Water", bg: "bg-blue-900/50" },
  cave: { icon: "⛰", label: "Cave", bg: "bg-stone-700/50" }
};

// Layout rows for grid rendering (rows of location names)
function useGameState(socket: Socket | null) {
  const [phase, setPhase] = useState<Phase>("home");
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [currentPlayerIndex, setCurrentPlayerIndex] = useState(0);
  const [wildEncounter, setWildEncounter] = useState<null | { pokemon: Pokemon; location: string; triggeredByPlayerId?: string }>(null);
  const [encounterLog, setEncounterLog] = useState<string[]>([]);
  const [pendingLearn, setPendingLearn] = useState<null | { playerIndex: number; pokemonIndex: number; newMove: string; newLevel: number; remainingMoves?: string[] }>(null);
  const [evolutionNotice, setEvolutionNotice] = useState<null | { playerIndex: number; oldName: string; newName: string }>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [pvpRequest, setPvpRequest] = useState<PvpRequest | null>(null);
  const [pvpBattle, setPvpBattle] = useState<PvpBattle | null>(null);
  const [pvpTrade, setPvpTrade] = useState<PvpTrade | null>(null);
  const [pendingReplaceCapture, setPendingReplaceCapture] = useState<null | { pokemon: Pokemon; playerIndex: number }>(null);
  const pendingLevelUpsRef = useRef<Array<{ playerIdx: number; teamIndex: number; newLevel: number; monId: number; currentMoves: string[] }>>([]);
  const skipEmitRef = useRef(false);
  const skipEmitAfterPvpAcceptRef = useRef(false);
  const stateUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myBattleRef = useRef<{ phase: Phase; wildEncounter: typeof wildEncounter }>({ phase: "home", wildEncounter: null });
  const playersLengthRef = useRef(0);
  const soloSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const STATE_UPDATE_DEBOUNCE_MS = 120;
  myBattleRef.current = { phase, wildEncounter };
  playersLengthRef.current = players.length;
  const playersRef = useRef<Player[]>(players);
  playersRef.current = players;

  // Restore solo game after tab was killed (e.g. minimize on mobile)
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(SOLO_SAVE_KEY) : null;
      if (!raw) return;
      const data = JSON.parse(raw) as { roomCode?: string; phase?: Phase; players?: Player[]; currentPlayerIndex?: number };
      if (data?.roomCode === "SOLO" && Array.isArray(data.players) && data.players.length > 0) {
        setRoomCode("SOLO");
        setPhase(data.phase === "battle" ? "map" : (data.phase || "map"));
        setPlayers(data.players.map((p: Player) => normalizePlayer(p)));
        setCurrentPlayerIndex(data.currentPlayerIndex ?? 0);
        setWildEncounter(null);
      }
    } catch {
      // ignore invalid saved state
    }
  }, []);

  // Persist solo game so it survives minimize/background and tab kill
  useEffect(() => {
    if (roomCode !== "SOLO" || players.length === 0) return;
    if (soloSaveTimeoutRef.current) clearTimeout(soloSaveTimeoutRef.current);
    soloSaveTimeoutRef.current = setTimeout(() => {
      try {
        const toSave = phase === "battle" ? "map" : phase;
        localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify({ roomCode, phase: toSave, players, currentPlayerIndex }));
      } catch {
        // ignore quota / private mode
      }
    }, 350);
    return () => {
      if (soloSaveTimeoutRef.current) {
        clearTimeout(soloSaveTimeoutRef.current);
        soloSaveTimeoutRef.current = null;
      }
    };
  }, [roomCode, phase, players, currentPlayerIndex]);

  const replaceState = (s: GameStateSnapshot) => {
    skipEmitRef.current = true;
    skipEmitAfterPvpAcceptRef.current = false;
    const inMyBattle = socket && myBattleRef.current.wildEncounter?.triggeredByPlayerId === socket.id;
    const incomingClearsBattle = s.phase !== "battle" || !s.wildEncounter;
    const someoneJustJoined = s.players != null && s.players.length > playersLengthRef.current;
    const playersWithBag = (s.players ?? []).map((p: Player) => normalizePlayer(p));
    if (inMyBattle && (incomingClearsBattle || someoneJustJoined)) {
      const myId = socket?.id;
      // Don't apply incoming players for ourselves: keep our identity (color, team, name, badges) from
      // current state so a bad state from the other client (e.g. after they enter battle) can't overwrite us.
      setPlayers((prev) => {
        if (!myId) return playersWithBag;
        return playersWithBag.map((p) => {
          if (p.id !== myId) return p;
          const myPrev = prev.find((x) => x.id === myId);
          if (!myPrev) return p;
          const mergedBadges = [...new Set([...(myPrev.badges ?? []), ...(p.badges ?? [])])];
          return {
            ...myPrev,
            badges: mergedBadges.length > 0 ? mergedBadges : (myPrev.badges ?? p.badges ?? []),
            bag: p.bag ?? myPrev.bag,
            tilePos: p.tilePos ?? myPrev.tilePos ?? toTilePosition(p.location ?? myPrev.location, LOCATION_POINTS[p.location ?? myPrev.location] ?? { x: 18, y: 70 }),
            spriteId: p.spriteId ?? myPrev.spriteId,
            facing: p.facing ?? myPrev.facing,
            moving: p.moving ?? myPrev.moving,
            expShare: myPrev.expShare !== undefined ? myPrev.expShare : p.expShare,
            wildEncounter: p.wildEncounter ?? myPrev.wildEncounter,
            encounterLog: p.encounterLog ?? myPrev.encounterLog,
            pendingLearn: p.pendingLearn ?? myPrev.pendingLearn,
            evolutionNotice: p.evolutionNotice ?? myPrev.evolutionNotice
          };
        });
      });
      setCurrentPlayerIndex(s.currentPlayerIndex ?? 0);
      const my = socket ? playersWithBag.find((p) => p.id === socket.id) : null;
      setEncounterLog(my?.encounterLog ?? s.encounterLog ?? []);
      setPendingLearn(my?.pendingLearn ?? s.pendingLearn ?? null);
      setEvolutionNotice(my?.evolutionNotice ?? s.evolutionNotice ?? null);
      setPvpRequest(s.pvpRequest ?? null);
      setPvpBattle(s.pvpBattle ?? null);
      setPvpTrade(s.pvpTrade ?? null);
      setPendingReplaceCapture(null);
      return;
    }
    setPhase(s.phase);
    setRoomCode(s.roomCode || "");
    // When state came from another client's stateUpdate, don't let it overwrite our identity (team, color, location…) so we never "become" the other player or lose wild encounters.
    if (socket && s._fromSocketId != null && s._fromSocketId !== socket.id) {
      setPlayers((prev) => {
        const myId = socket.id;
        return playersWithBag.map((p) => {
          if (p.id !== myId) return p;
          const myPrev = prev.find((x) => x.id === myId);
          if (!myPrev) return p;
          const mergedBadges = [...new Set([...(myPrev.badges ?? []), ...(p.badges ?? [])])];
          return {
            ...myPrev,
            badges: mergedBadges.length > 0 ? mergedBadges : (myPrev.badges ?? p.badges ?? []),
            bag: p.bag ?? myPrev.bag,
            tilePos: myPrev.tilePos ?? p.tilePos ?? toTilePosition(p.location ?? myPrev.location, LOCATION_POINTS[p.location ?? myPrev.location] ?? { x: 18, y: 70 }),
            spriteId: p.spriteId ?? myPrev.spriteId,
            facing: p.facing ?? myPrev.facing,
            moving: p.moving ?? myPrev.moving,
            expShare: myPrev.expShare !== undefined ? myPrev.expShare : p.expShare,
            wildEncounter: myPrev.wildEncounter ?? p.wildEncounter,
            encounterLog: myPrev.encounterLog ?? p.encounterLog,
            pendingLearn: myPrev.pendingLearn ?? p.pendingLearn,
            evolutionNotice: myPrev.evolutionNotice ?? p.evolutionNotice
          };
        });
      });
    } else {
      setPlayers(playersWithBag);
    }
    setCurrentPlayerIndex(s.currentPlayerIndex ?? 0);
    const myPlayer = socket ? playersWithBag.find((p) => p.id === socket.id) : null;
    if (!(socket && s._fromSocketId != null && s._fromSocketId !== socket.id)) {
      setWildEncounter(myPlayer?.wildEncounter ?? s.wildEncounter ?? null);
      setEncounterLog(myPlayer?.encounterLog ?? s.encounterLog ?? []);
      setPendingLearn(myPlayer?.pendingLearn ?? s.pendingLearn ?? null);
      setEvolutionNotice(myPlayer?.evolutionNotice ?? s.evolutionNotice ?? null);
    }
    setPvpRequest(s.pvpRequest ?? null);
    setPvpBattle(s.pvpBattle ?? null);
    setPvpTrade(s.pvpTrade ?? null);
    setPendingReplaceCapture(null);
  };

  useEffect(() => {
    if (!socket) return;
    const onRoomCreated = (data: { roomCode: string; state: GameStateSnapshot }) => {
      replaceState(data.state);
    };
    const onState = (state: GameStateSnapshot) => {
      replaceState(state);
    };
    const onJoinError = (data: { message?: string }) => {
      setJoinError(data?.message ?? "Could not join room");
    };
    const onPlayerMoved = (data: {
      playerId?: string;
      tilePos?: TilePosition;
      facing?: Direction;
      moving?: boolean;
      seq?: number;
    }) => {
      if (!data?.playerId || !data?.tilePos || !hasMapId(data.tilePos.mapId)) return;
      // Local player already applied optimistic movement.
      if (socket.id && data.playerId === socket.id) return;
      const map = getMapById(data.tilePos.mapId);
      setPlayers((ps) =>
        ps.map((pl) => {
          if (pl.id !== data.playerId) return pl;
          const prevSeq = pl.moveSeq ?? 0;
          if (data.seq != null && data.seq < prevSeq) return pl;
          return {
            ...pl,
            tilePos: data.tilePos,
            facing: data.facing ?? pl.facing,
            moving: data.moving ?? false,
            moveSeq: data.seq ?? prevSeq,
            location: map.locationName || pl.location,
          };
        })
      );
    };
    socket.on("roomCreated", onRoomCreated);
    socket.on("state", onState);
    socket.on("joinError", onJoinError);
    socket.on("playerMoved", onPlayerMoved);
    const onMoveRejected = (data: {
      playerId?: string;
      tilePos?: TilePosition;
      facing?: Direction;
      moving?: boolean;
      seq?: number;
    }) => {
      if (!data?.tilePos || !socket.id || data.playerId !== socket.id) return;
      setPlayers((ps) =>
        ps.map((pl) =>
          pl.id === socket.id
            ? {
                ...pl,
                tilePos: data.tilePos,
                facing: data.facing ?? pl.facing,
                moving: false,
                moveSeq: data.seq ?? pl.moveSeq,
              }
            : pl
        )
      );
    };
    socket.on("moveRejected", onMoveRejected);
    return () => {
      socket.off("roomCreated", onRoomCreated);
      socket.off("state", onState);
      socket.off("joinError", onJoinError);
      socket.off("playerMoved", onPlayerMoved);
      socket.off("moveRejected", onMoveRejected);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !roomCode || roomCode === "SOLO") return;
    if (skipEmitRef.current) {
      skipEmitRef.current = false;
      if (stateUpdateTimeoutRef.current) {
        clearTimeout(stateUpdateTimeoutRef.current);
        stateUpdateTimeoutRef.current = null;
      }
      return;
    }
    if (skipEmitAfterPvpAcceptRef.current) {
      skipEmitAfterPvpAcceptRef.current = false;
      if (stateUpdateTimeoutRef.current) {
        clearTimeout(stateUpdateTimeoutRef.current);
        stateUpdateTimeoutRef.current = null;
      }
      return;
    }
    if (stateUpdateTimeoutRef.current) clearTimeout(stateUpdateTimeoutRef.current);
    stateUpdateTimeoutRef.current = setTimeout(() => {
      stateUpdateTimeoutRef.current = null;
      const snapshot: GameStateSnapshot = {
        phase,
        roomCode,
        players,
        currentPlayerIndex,
        wildEncounter,
        encounterLog,
        pendingLearn,
        evolutionNotice,
        pvpRequest,
        pvpBattle,
        pvpTrade
      };
      socket.emit("stateUpdate", snapshot);
    }, STATE_UPDATE_DEBOUNCE_MS);
    return () => {
      if (stateUpdateTimeoutRef.current) {
        clearTimeout(stateUpdateTimeoutRef.current);
        stateUpdateTimeoutRef.current = null;
      }
    };
  }, [socket, roomCode, phase, players, currentPlayerIndex, wildEncounter, encounterLog, pendingLearn, evolutionNotice, pvpRequest, pvpBattle, pvpTrade]);

  const addPlayer = (name: string) => {
    setPlayers((p) => {
      if (p.length >= MAX_ROOM_PLAYERS) return p;
      const next: Player = {
        id: `p${p.length + 1}`,
        name,
        color: ROOM_PLAYER_COLORS[p.length % ROOM_PLAYER_COLORS.length],
        isReady: false,
        screen: "lobby",
        location: "Pallet Town",
        tilePos: { ...DEFAULT_SPAWN },
        spriteId: PLAYER_SPRITE_PRESETS[p.length % PLAYER_SPRITE_PRESETS.length]?.id ?? PLAYER_SPRITE_PRESETS[0].id,
        facing: "down",
        moving: false,
        lastTown: "Pallet Town",
        team: [],
        badges: [],
        bag: { ...DEFAULT_BAG }
      };
      return [...p, next];
    });
  };

  const toggleReady = (id: string) =>
    setPlayers((ps) => ps.map((pl) => (pl.id === id ? { ...pl, isReady: !pl.isReady } : pl)));

  const startGameIfReady = (forPlayerId?: string) => {
    if (players.length === 0) return;
    if (forPlayerId) {
      setPlayers((ps) => ps.map((pl) => (pl.id === forPlayerId ? { ...pl, screen: "sprite" as PlayerScreen } : pl)));
      return;
    }
    const allReady = players.every((p) => p.isReady);
    const canStart = allReady || players.length === 1;
    if (canStart) {
      setPlayers((ps) => ps.map((pl) => ({ ...pl, screen: "sprite" as PlayerScreen })));
      setPhase("starter");
    }
  };

  const startSingleplayer = (playerName: string) => {
    const name = (playerName || "Player 1").trim() || "Player 1";
    skipEmitRef.current = true;
    setRoomCode("SOLO");
    setPhase("lobby");
    setPlayers([{
      id: "solo",
      name,
      color: ROOM_PLAYER_COLORS[0],
      isHost: true,
      isReady: true,
      screen: "lobby",
      location: "Pallet Town",
      tilePos: { ...DEFAULT_SPAWN },
      spriteId: PLAYER_SPRITE_PRESETS[0].id,
      facing: "down",
      moving: false,
      lastTown: "Pallet Town",
      team: [],
      badges: [],
      bag: { ...DEFAULT_BAG }
    }]);
    setCurrentPlayerIndex(0);
    setWildEncounter(null);
    setPvpRequest(null);
    setPvpBattle(null);
    setPvpTrade(null);
  };

  const selectSprite = (playerId: string, spriteId: string) => {
    if (!PLAYER_SPRITE_PRESETS.some((s: { id: string }) => s.id === spriteId)) return;
    setPlayers((ps) =>
      ps.map((pl) => (pl.id === playerId ? { ...pl, spriteId, screen: "starter" as PlayerScreen } : pl))
    );
  };

  const selectStarter = (playerId: string, starterId: number) => {
    getPokemonTemplate(starterId).then((tpl) => {
      const inst = makeInstanceFromTemplate(tpl, 5);
      setPlayers((ps) =>
        ps.map((pl) =>
          pl.id === playerId
            ? {
                ...pl,
                team: [{ ...inst }],
                location: "Pallet Town",
                tilePos: { ...DEFAULT_SPAWN },
                screen: "map" as PlayerScreen,
                lastTown: "Pallet Town",
              }
            : pl
        )
      );
      pokedexCaught(playerId, starterId);
    }).catch(() => {});
    setTimeout(() => {
      const all = players.every((p) => p.team.length > 0 || p.id === playerId);
      if (all) setPhase("map");
    }, 50);
  };

  const movePlayer = (
    playerId: string,
    to: string,
    options?: { skipEntryEncounter?: boolean; spawnTile?: TilePosition; skipTownUi?: boolean; fromTile?: TilePosition }
  ) => {
    const pl = players.find((p) => p.id === playerId);
    if (pl) {
      const fromLoc = LOCATIONS[pl.location];
      if (fromLoc?.gym && fromLoc.gym !== "Giovanni" && GYM_BLOCKED_EXITS[pl.location]?.includes(to) && !pl.badges?.includes(fromLoc.gym)) {
        return;
      }
    }
    const targetMap = getMapForLocation(to);
    const targetTile = options?.spawnTile ?? { mapId: targetMap.id, x: targetMap.spawn.x, y: targetMap.spawn.y };
    const facingForEmit = (pl?.facing ?? "down") as Direction;
    setPlayers((ps) =>
      ps.map((pl) =>
        pl.id === playerId
          ? {
              ...pl,
              location: to,
              tilePos: targetTile,
              lastTown: LOCATIONS[to]?.type === "town" ? to : pl.lastTown,
            }
          : pl
      )
    );
    if (socket && roomCode && roomCode !== "SOLO" && socket.id === playerId) {
      const payload: {
        mapId: string;
        x: number;
        y: number;
        facing: Direction;
        moving: boolean;
        viaTile?: TilePosition;
      } = {
        mapId: targetTile.mapId,
        x: targetTile.x,
        y: targetTile.y,
        facing: facingForEmit,
        moving: false,
      };
      if (options?.fromTile) payload.viaTile = options.fromTile;
      socket.emit("playerMove", payload);
    }
    if (options?.skipEntryEncounter) return;
    const loc = LOCATIONS[to];
    const pool = loc ? getWildPool(loc) : [];
    const canEncounter = pool.length > 0 && (loc?.type === "grass" || loc?.type === "cave" || loc?.type === "water");
    const plAfterMove = players.find((p) => p.id === playerId);
    const repelActive = normalizeBag(plAfterMove?.bag).repel > 0;
    if (repelActive && canEncounter) {
      useItem(playerId, "repel");
    }
    if (canEncounter && !repelActive) {
      sound.playSfx("battle-start");
      const pid = pool[Math.floor(Math.random() * pool.length)];
      getPokemonTemplate(pid).then((tpl) => {
        const lvl = getWildLevel(loc);
        const inst = makeInstanceFromTemplate(tpl, lvl);
        const shiny = Math.random() < SHINY_CHANCE;
        if (shiny) {
          (inst as any).isShiny = true;
          inst.sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${pid}.png`;
          inst.name = `★ ${inst.name}`;
        }
        const encounter = { pokemon: inst as Pokemon, location: to, triggeredByPlayerId: playerId };
        pokedexSeen(playerId, pid);
        myBattleRef.current = { phase: "battle", wildEncounter: encounter };
        setWildEncounter(encounter);
        setTimeout(() => setPhase("battle"), 50);
      }).catch(() => {});
    }
  };

  const walkPlayer = (playerId: string, direction: Direction) => {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const loc = LOCATIONS[player.location];
    if (!loc?.connections?.length) return;
    const next = pickDirectionalConnection(player.location, loc.connections, LOCATION_POINTS, direction);
    if (!next) return;
    movePlayer(playerId, next);
  };

  const setPlayerTilePos = (playerId: string, next: TilePosition, facing: Direction, moving: boolean) => {
    setPlayers((ps) =>
      ps.map((pl) => {
        if (pl.id !== playerId) return pl;
        const normalized = normalizePlayer(pl);
        return {
          ...normalized,
          tilePos: next,
          facing,
          moving,
        };
      })
    );
    if (socket && roomCode && roomCode !== "SOLO" && socket.id === playerId) {
      socket.emit("playerMove", {
        mapId: next.mapId,
        x: next.x,
        y: next.y,
        facing,
        moving,
      });
    }
  };

  const setPlayerSprite = (playerId: string, spriteId: string) => {
    if (!PLAYER_SPRITE_PRESETS.some((s: { id: string }) => s.id === spriteId)) return;
    setPlayers((ps) => ps.map((pl) => (pl.id === playerId ? { ...pl, spriteId } : pl)));
  };

  const searchWild = (playerId: string) => {
    const pl = players.find((p) => p.id === playerId);
    if (!pl) return;
    const loc = LOCATIONS[pl.location];
    const pool = loc ? getWildPool(loc) : [];
    if (!loc || pool.length === 0) return;
    const repelActive = normalizeBag(pl.bag).repel > 0;
    if (repelActive) {
      useItem(playerId, "repel");
      return;
    }
    sound.playSfx("battle-start");
    const pid = pool[Math.floor(Math.random() * pool.length)];
    getPokemonTemplate(pid).then((tpl) => {
      const lvl = getWildLevel(loc);
      const inst = makeInstanceFromTemplate(tpl, lvl);
      const shiny = Math.random() < SHINY_CHANCE;
      if (shiny) {
        (inst as any).isShiny = true;
        inst.sprite = `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/shiny/${pid}.png`;
        inst.name = `★ ${inst.name}`;
      }
      const encounter = { pokemon: inst as Pokemon, location: pl.location, triggeredByPlayerId: playerId };
      pokedexSeen(playerId, pid);
      myBattleRef.current = { phase: "battle", wildEncounter: encounter };
      setWildEncounter(encounter);
      setTimeout(() => setPhase("battle"), 50);
    }).catch(() => {});
  };

  const captureAttempt = (chance = 0.8, forPlayerId?: string) => {
    if (!wildEncounter) return false;
    const idx = forPlayerId != null ? players.findIndex((p) => p.id === forPlayerId) : currentPlayerIndex;
    if (idx < 0) return false;
    const pl = players[idx];
    const pokeballs = pl?.bag?.pokeball ?? 0;
    if (pokeballs < 1) return false;
    // Sempre gasta 1 Poké Bola ao tentar (sucesso ou falha)
    const bag = normalizeBag(pl.bag);
    const newBag = { ...bag, pokeball: Math.max(0, bag.pokeball - 1) };
    setPlayers((ps) =>
      ps.map((p, i) => (i === idx ? { ...p, bag: newBag } : p))
    );
    const ok = Math.random() < chance;
    if (!ok) return false;
    sound.playSfx("capture");
    const caught = wildEncounter.pokemon;
    pokedexCaught(pl.id, caught.id);
    setWildEncounter(null);
    setPlayers((ps) =>
      ps.map((p, i) => {
        if (i !== idx) return p;
        const current = ps[i];
        if ((current.team.length ?? 0) < MAX_TEAM_SIZE) {
          return { ...current, team: [...current.team, caught] };
        }
        return current;
      })
    );
    if ((pl?.team.length ?? 0) >= MAX_TEAM_SIZE) {
      setPendingReplaceCapture({ pokemon: caught, playerIndex: idx });
    }
    return true;
  };

  const confirmReplaceCapture = (teamIndexToReplace: number) => {
    const pending = pendingReplaceCapture;
    if (!pending) return;
    setPlayers((ps) =>
      ps.map((pl, i) => {
        if (i !== pending.playerIndex) return pl;
        const team = [...pl.team];
        team[teamIndexToReplace] = pending.pokemon;
        return { ...pl, team };
      })
    );
    setPendingReplaceCapture(null);
  };
 
  const grantXpToTeamSlot = async (playerIdx: number, teamIndex: number, xpGain: number) => {
    const pl = playersRef.current[playerIdx];
    if (!pl) return;
    const mon = pl.team[teamIndex];
    if (!mon) return;
    const oldLevel = mon.level ?? 1;
    let newXp = (mon.xp ?? 0) + xpGain;
    let level = oldLevel;
    let xpToNext = mon.xpToNext ?? xpToNextForLevel(level);
    while (newXp >= xpToNext) {
      newXp -= xpToNext;
      level += 1;
      xpToNext = xpToNextForLevel(level);
    }
    const levelGained = level - oldLevel;
    if (levelGained > 0) sound.playSfx("level-up");
    try {
      const tpl = await getPokemonTemplate(mon.id);
      const newInst = makeInstanceFromTemplate(tpl, level);
      const moves = mon.moves ?? [];
      const newHp = levelGained > 0 ? newInst.maxHp : Math.min(mon.hp ?? newInst.maxHp, newInst.maxHp);
      const updatedMon = { ...mon, level, xp: newXp, xpToNext, maxHp: newInst.maxHp, hp: newHp, stats: newInst.stats, moves };
      setPlayers((ps) =>
        ps.map((p, idx) => (idx === playerIdx ? { ...p, team: p.team.map((m, i) => (i === teamIndex ? updatedMon : m)) } : p))
      );
      if (levelGained > 0) {
        let didEvolve = false;
        try {
          const evo = await getNextEvolution(mon.id);
          if (evo && (evo.minLevel === null || level >= evo.minLevel)) {
            const evoTpl = await getPokemonTemplate(evo.id);
            const evolved = makeInstanceFromTemplate(evoTpl, level);
            setPlayers((ps) =>
              ps.map((p, idx) => (idx === playerIdx ? { ...p, team: p.team.map((m, i) => (i === teamIndex ? evolved : m)) } : p))
            );
            sound.playSfx("evolution");
            setEvolutionNotice({ playerIndex: playerIdx, oldName: mon.name, newName: evolved.name });
            didEvolve = true;
          }
        } catch {}
        if (!didEvolve) {
          const newMovesAtLevel = getMovesLearnedAtLevel(tpl.moves as any, level);
          const toLearn = newMovesAtLevel.filter((m) => !moves.includes(m));
          if (toLearn.length > 0) {
            setPendingLearn({ playerIndex: playerIdx, pokemonIndex: teamIndex, newMove: toLearn[0], newLevel: level, remainingMoves: toLearn.slice(1) });
          }
        }
      }
    } catch {
      const st = mon.stats ?? { attack: 5, defense: 5, speed: 5 };
      const newMaxHp = (mon.maxHp ?? 10) + levelGained * 2;
      const newStats = {
        attack: (st.attack ?? 5) + levelGained,
        defense: (st.defense ?? 5) + levelGained,
        speed: (st.speed ?? 5) + levelGained,
        ...((st as any).specialAttack != null && {
          specialAttack: ((st as any).specialAttack ?? 5) + levelGained,
          specialDefense: ((st as any).specialDefense ?? 5) + levelGained
        })
      };
      const newHp = levelGained > 0 ? newMaxHp : Math.min(mon.hp ?? newMaxHp, newMaxHp);
      setPlayers((ps) =>
        ps.map((p, idx) =>
          idx === playerIdx
            ? { ...p, team: p.team.map((m, i) => (i === teamIndex ? { ...mon, level, xp: newXp, xpToNext, maxHp: newMaxHp, hp: newHp, stats: newStats } : m)) }
            : p
        )
      );
    }
  };

  const grantXpToLead = (playerIdx: number, xpGain: number) => grantXpToTeamSlot(playerIdx, 0, xpGain);

  const processNextPendingLevelUp = async () => {
    const queue = pendingLevelUpsRef.current;
    if (queue.length === 0) return;
    const entry = queue.shift()!;
    const { playerIdx, teamIndex, newLevel, monId, currentMoves } = entry;
    try {
      const tpl = await getPokemonTemplate(monId);
      const newMovesAtLevel = getMovesLearnedAtLevel(tpl.moves as any, newLevel);
      const toLearn = newMovesAtLevel.filter((m) => !currentMoves.includes(m));
      if (toLearn.length > 0) {
        setPendingLearn({ playerIndex: playerIdx, pokemonIndex: teamIndex, newMove: toLearn[0], newLevel, remainingMoves: toLearn.slice(1) });
        return;
      }
    } catch {
      // ignore template/move errors
    }
    processNextPendingLevelUp();
  };

  const grantXpToParticipants = async (playerIdx: number, xpGain: number, participantIds: number[]) => {
    if (!participantIds.length) return;
    const idSet = new Set(participantIds);
    setPlayers((ps) => {
      const pl = ps[playerIdx];
      if (!pl?.team?.length) return ps;
      const useExpShare = pl.expShare !== false;
      const levelUps: Array<{ playerIdx: number; teamIndex: number; newLevel: number; monId: number; currentMoves: string[] }> = [];
      const newTeam = pl.team.map((mon, teamIndex) => {
        const xpToAdd = idSet.has(mon.id) ? xpGain : (useExpShare ? Math.floor(xpGain * 0.5) : 0);
        if (xpToAdd <= 0) return mon;
        const oldLevel = mon.level ?? 1;
        let newXp = (mon.xp ?? 0) + xpToAdd;
        let level = oldLevel;
        let xpToNext = mon.xpToNext ?? xpToNextForLevel(level);
        while (newXp >= xpToNext) {
          newXp -= xpToNext;
          level += 1;
          xpToNext = xpToNextForLevel(level);
        }
        const levelGained = level - oldLevel;
        if (levelGained > 0) {
          sound.playSfx("level-up");
          levelUps.push({ playerIdx, teamIndex, newLevel: level, monId: mon.id, currentMoves: mon.moves ?? [] });
        }
        const st = mon.stats ?? { attack: 5, defense: 5, speed: 5 };
        const newMaxHp = (mon.maxHp ?? 10) + levelGained * 2;
        const newStats = {
          attack: (st.attack ?? 5) + levelGained,
          defense: (st.defense ?? 5) + levelGained,
          speed: (st.speed ?? 5) + levelGained,
          ...((st as any).specialAttack != null && {
            specialAttack: ((st as any).specialAttack ?? 5) + levelGained,
            specialDefense: ((st as any).specialDefense ?? 5) + levelGained
          })
        };
        const newHp = levelGained > 0 ? newMaxHp : Math.min(mon.hp ?? newMaxHp, newMaxHp);
        return { ...mon, level, xp: newXp, xpToNext, maxHp: newMaxHp, hp: newHp, stats: newStats };
      });
      pendingLevelUpsRef.current = levelUps;
      return ps.map((p, idx) => (idx === playerIdx ? { ...p, team: newTeam } : p));
    });
    setTimeout(() => processNextPendingLevelUp(), 0);
  };

  const toggleExpShare = (playerIdx?: number) => {
    const idx = playerIdx ?? (currentPlayerIndex >= 0 && currentPlayerIndex < players.length ? currentPlayerIndex : 0);
    setPlayers((ps) => {
      const p = ps[idx];
      if (!p) return ps;
      return ps.map((pl, i) => (i === idx ? { ...pl, expShare: !(pl.expShare !== false) } : pl));
    });
  };

  const attackWild = async (moveName?: string) => {
    if (!wildEncounter) return;
    // In multiplayer use the player who triggered this encounter, not shared currentPlayerIndex
    const playerIdx = wildEncounter.triggeredByPlayerId != null
      ? players.findIndex((p) => p.id === wildEncounter.triggeredByPlayerId)
      : currentPlayerIndex;
    if (playerIdx < 0) return;
    const player = players[playerIdx];
    const lead = player.team[0];
    if (!lead) return;
    let power = 5;
    let moveType = "normal";
    if (moveName) {
      try {
        const mv = await import("./api/pokeapi").then(m => m.getMoveData(moveName));
        if (mv.power) power = mv.power;
        if (mv.type) moveType = mv.type;
      } catch {
        power = 5;
      }
    }
    const { getTypeEffectiveness } = await import("./engine/battle");
    const defenderTypes = wildEncounter.pokemon.types ?? ["normal"];
    const { multiplier: typeMult } = getTypeEffectiveness(moveType, defenderTypes);
    const atk = lead.stats?.attack ?? 5;
    const def = wildEncounter.pokemon.stats?.defense ?? 5;
    const baseDmg = (atk / Math.max(1, def)) * power * (Math.random() * 0.4 + 0.8);
    const dmg = Math.max(typeMult === 0 ? 0 : 1, Math.floor(baseDmg * typeMult));
    // apply damage to wild
    setWildEncounter((we) => {
      if (!we) return we;
      const newHp = Math.max(0, we.pokemon.hp - dmg);
      const updated = { ...we, pokemon: { ...we.pokemon, hp: newHp } };
      return updated;
    });
    // grant small xp to lead (playerIdx already set above from encounter owner)
    const playerState = players[playerIdx];
    if (playerState && playerState.team[0]) {
      const lead = playerState.team[0];
      const newXp = (lead.xp ?? 0) + 1;
      const xpToNext = lead.xpToNext ?? xpToNextForLevel(lead.level ?? 1);
      const willLevel = newXp >= xpToNext;

      if (willLevel) {
        const newLevel = (lead.level ?? 1) + 1;
        try {
          const tpl = await getPokemonTemplate(lead.id);
          const newMoves = getMovesForLevel(tpl.moves as any, newLevel);
          // update stats now
          setPlayers((ps) =>
            ps.map((pl, idx) => {
              if (idx !== playerIdx) return pl;
              if (!pl.team[0]) return pl;
              const newMaxHp = Math.max(1, Math.floor((pl.team[0].maxHp ?? 10) + 2));
              const newAttack = Math.max(1, Math.floor(((pl.team[0].stats?.attack ?? 5) + 1)));
              const newDefense = Math.max(1, Math.floor(((pl.team[0].stats?.defense ?? 5) + 1)));
              const newSpeed = (pl.team[0].stats?.speed ?? 5) + 1;
              const team0 = {
                ...pl.team[0],
                level: newLevel,
                xp: newXp - xpToNext,
                xpToNext: xpToNextForLevel(newLevel),
                maxHp: newMaxHp,
                hp: newMaxHp,
                stats: { attack: newAttack, defense: newDefense, speed: newSpeed },
                moves: pl.team[0].moves ?? []
              };
              const newTeam = [team0, ...pl.team.slice(1)];
              return { ...pl, team: newTeam };
            })
          );
          // evolution first: if it evolves, evolved mon already has correct moves from template
          let didEvolve = false;
          try {
            const evo = await getNextEvolution(lead.id);
            if (evo && (evo.minLevel === null || newLevel >= evo.minLevel)) {
              const evoTpl = await getPokemonTemplate(evo.id);
              const evolved = makeInstanceFromTemplate(evoTpl, newLevel);
              setPlayers((ps) =>
                ps.map((pl, idx) => {
                  if (idx !== playerIdx) return pl;
                  if (!pl.team[0]) return pl;
                  const newTeam = [evolved, ...pl.team.slice(1)];
                  return { ...pl, team: newTeam };
                })
              );
              sound.playSfx("evolution");
              setEvolutionNotice({ playerIndex: playerIdx, oldName: lead.name, newName: evolved.name });
              didEvolve = true;
            }
          } catch {
            // ignore evolution errors
          }
          if (!didEvolve) {
            const newMovesAtLevel = getMovesLearnedAtLevel(tpl.moves as any, newLevel);
            const toLearn = newMovesAtLevel.filter((m) => !(lead.moves ?? []).includes(m));
            if (toLearn.length > 0) {
              setPendingLearn({ playerIndex: playerIdx, pokemonIndex: 0, newMove: toLearn[0], newLevel, remainingMoves: toLearn.slice(1) });
            }
          }
        } catch {
          // fallback: update stats without move changes
          setPlayers((ps) =>
            ps.map((pl, idx) => {
              if (idx !== playerIdx) return pl;
              if (!pl.team[0]) return pl;
              const newMaxHp = Math.max(1, Math.floor((pl.team[0].maxHp ?? 10) + 2));
              const newAttack = Math.max(1, Math.floor(((pl.team[0].stats?.attack ?? 5) + 1)));
              const newDefense = Math.max(1, Math.floor(((pl.team[0].stats?.defense ?? 5) + 1)));
              const newSpeed = (pl.team[0].stats?.speed ?? 5) + 1;
              const team0 = {
                ...pl.team[0],
                level: newLevel,
                xp: newXp - xpToNext,
                xpToNext: xpToNextForLevel(newLevel),
                maxHp: newMaxHp,
                hp: newMaxHp,
                stats: { attack: newAttack, defense: newDefense, speed: newSpeed }
              };
              const newTeam = [team0, ...pl.team.slice(1)];
              return { ...pl, team: newTeam };
            })
          );
        }
      } else {
        setPlayers((ps) =>
          ps.map((pl, idx) => {
            if (idx !== playerIdx) return pl;
            if (!pl.team[0]) return pl;
            const team0 = { ...pl.team[0], xp: newXp };
            const newTeam = [team0, ...pl.team.slice(1)];
            return { ...pl, team: newTeam };
          })
        );
      }
    }
    const effMsg = typeMult >= 2 ? " It's super effective!" : typeMult <= 0.5 && typeMult > 0 ? " It's not very effective..." : typeMult === 0 ? " It doesn't affect the target." : "";
    setEncounterLog((l) => [`You used ${moveName ?? "Tackle"} and dealt ${dmg} damage.${effMsg}`, ...l].slice(0, 6));
    // wild retaliates if still alive (use same player index as attacker)
    const battlePlayerIdx = playerIdx;
    setTimeout(() => {
      setWildEncounter((we) => {
        if (!we) return we;
        if (we.pokemon.hp <= 0) return we;
        const wildAtk = we.pokemon.stats?.attack ?? 5;
        const playerDef = players[battlePlayerIdx]?.team[0]?.stats?.defense ?? 5;
        const wildDmg = Math.max(1, Math.floor((wildAtk / playerDef) * 4 * (Math.random() * 0.4 + 0.8)));
        // apply damage to player's lead
        setPlayers((ps) =>
          ps.map((pl, idx) => {
            if (idx !== battlePlayerIdx) return pl;
            if (!pl.team[0]) return pl;
            const newHp = Math.max(0, (pl.team[0].hp ?? pl.team[0].maxHp) - wildDmg);
            let team0 = { ...pl.team[0], hp: newHp };
            if (newHp <= 0) {
              team0.isFainted = true;
              team0.hp = 1; // revive to 1 for demo
            }
            const newTeam = [team0, ...pl.team.slice(1)];
            return { ...pl, team: newTeam };
          })
        );
        setEncounterLog((l) => [`Wild ${we.pokemon.name} hit you for ${wildDmg} damage.`, ...l].slice(0, 6));
        return we;
      });
    }, 500);
  };

  const updatePlayerLead = (playerId: string, leadIndex: number) => {
    setPlayers((ps) =>
      ps.map((pl) => {
        if (pl.id !== playerId || !pl.team.length) return pl;
        const idx = Math.floor(Math.max(0, Math.min(Number(leadIndex), pl.team.length - 1)));
        const newLead = pl.team[idx];
        const rest = pl.team.filter((_, i) => i !== idx);
        const newTeam = [newLead, ...rest].slice(0, pl.team.length);
        return { ...pl, team: newTeam };
      })
    );
  };

  const updateLeadPokemon = (playerId: string, updatedMon: Pokemon) => {
    setPlayers((ps) =>
      ps.map((pl) => (pl.id === playerId && pl.team.length > 0 ? { ...pl, team: [updatedMon, ...pl.team.slice(1)] } : pl))
    );
  };

  const healPlayer = (playerId: string) => {
    setPlayers((ps) =>
      ps.map((pl) => {
        if (pl.id !== playerId) return pl;
        const newTeam = pl.team.map((m) => ({ ...m, hp: m.maxHp, isFainted: false }));
        return { ...pl, team: newTeam };
      })
    );
  };

  const whiteout = (playerId: string) => {
    const pl = players.find((p) => p.id === playerId);
    if (!pl) return;
    const lastTown = (() => {
      if (pl.lastTown) return pl.lastTown;
      const loc = LOCATIONS[pl.location];
      if (loc?.type === "town") return pl.location;
      const visited = Object.entries(LOCATIONS).filter(([, v]) => v.type === "town");
      return visited.length > 0 ? visited[0][0] : "Pallet Town";
    })();
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const newTeam = p.team.map((m) => ({ ...m, hp: m.maxHp, isFainted: false }));
        const bag = normalizeBag(p.bag);
        const lostCoins = Math.floor(bag.coins / 2);
        const townMap = getMapForLocation(lastTown);
        return {
          ...p,
          team: newTeam,
          location: lastTown,
          lastTown,
          tilePos: { mapId: townMap.id, x: townMap.spawn.x, y: townMap.spawn.y },
          bag: { ...bag, coins: bag.coins - lostCoins },
        };
      })
    );
  };

  const pokedexSeen = (playerId: string, pokemonId: number) => {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const dex = p.pokedex ?? { seen: [], caught: [] };
        if (dex.seen.includes(pokemonId)) return p;
        return { ...p, pokedex: { ...dex, seen: [...dex.seen, pokemonId] } };
      })
    );
  };

  const pokedexCaught = (playerId: string, pokemonId: number) => {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const dex = p.pokedex ?? { seen: [], caught: [] };
        const newSeen = dex.seen.includes(pokemonId) ? dex.seen : [...dex.seen, pokemonId];
        const newCaught = dex.caught.includes(pokemonId) ? dex.caught : [...dex.caught, pokemonId];
        return { ...p, pokedex: { seen: newSeen, caught: newCaught } };
      })
    );
  };

  const addBadge = (playerId: string, badge: string) => {
    setPlayers((ps) =>
      ps.map((pl) => (pl.id === playerId && !pl.badges.includes(badge) ? { ...pl, badges: [...pl.badges, badge] } : pl))
    );
  };

  const addCoins = (playerId: string, amount: number) => {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const bag = normalizeBag(p.bag);
        return { ...p, bag: { ...bag, coins: bag.coins + amount } };
      })
    );
  };

  const buyItem = (playerId: string, item: keyof Bag, price: number) => {
    const pl = players.find((p) => p.id === playerId);
    const coins = pl?.bag?.coins ?? 0;
    if (coins < price) return false;
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const bag = normalizeBag(p.bag);
        return { ...p, bag: { ...bag, [item]: (bag[item] as number) + 1, coins: bag.coins - price } };
      })
    );
    return true;
  };

  const buyPokeball = (playerId: string) => buyItem(playerId, "pokeball", POKEBALL_PRICE);

  const useItem = (playerId: string, item: keyof Bag, amount = 1) => {
    setPlayers((ps) =>
      ps.map((p) => {
        if (p.id !== playerId) return p;
        const bag = normalizeBag(p.bag);
        if ((bag[item] as number) < amount) return p;
        return { ...p, bag: { ...bag, [item]: (bag[item] as number) - amount } };
      })
    );
  };

  const finalizeLearn = (replaceIndex: number | null) => {
    if (!pendingLearn) return;
    const { playerIndex, pokemonIndex, newMove, newLevel, remainingMoves } = pendingLearn;
    setPlayers((ps) =>
      ps.map((pl, idx) => {
        if (idx !== playerIndex) return pl;
        const mon = pl.team[pokemonIndex];
        if (!mon) return pl;
        const cur = mon.moves ?? [];
        let updatedMoves = cur;
        if (replaceIndex === null) {
          // skip learning
          updatedMoves = cur;
        } else if (replaceIndex === -1) {
          // add new move (slot free, < 4 moves)
          updatedMoves = [...cur, newMove].slice(0, 4);
        } else {
          updatedMoves = cur.slice();
          updatedMoves[replaceIndex] = newMove;
        }
        const newMon = { ...mon, moves: updatedMoves };
        const newTeam = pl.team.slice();
        newTeam[pokemonIndex] = newMon;
        return { ...pl, team: newTeam };
      })
    );
    if (remainingMoves && remainingMoves.length > 0) {
      setPendingLearn({ playerIndex, pokemonIndex, newMove: remainingMoves[0], newLevel, remainingMoves: remainingMoves.slice(1) });
    } else {
      setPendingLearn(null);
      setTimeout(() => processNextPendingLevelUp(), 0);
    }
  };

  const requestPvpBattle = (fromPlayerId: string, toPlayerId: string) => {
    if (fromPlayerId === toPlayerId) return;
    const from = players.find((p) => p.id === fromPlayerId);
    const to = players.find((p) => p.id === toPlayerId);
    if (!from || !to || from.team.length === 0 || to.team.length === 0) return;
    const closeEnough = canInteractPlayers(from, to) || canInteractPlayers(to, from);
    if (!closeEnough) return;
    setPvpRequest({ fromPlayerId, toPlayerId, type: "battle" });
  };

  const requestPvpTrade = (fromPlayerId: string, toPlayerId: string) => {
    if (fromPlayerId === toPlayerId) return;
    const from = players.find((p) => p.id === fromPlayerId);
    const to = players.find((p) => p.id === toPlayerId);
    if (!from || !to || from.team.length === 0 || to.team.length === 0) return;
    const closeEnough = canInteractPlayers(from, to) || canInteractPlayers(to, from);
    if (!closeEnough) return;
    setPvpRequest({ fromPlayerId, toPlayerId, type: "trade" });
  };

  const acceptPvpRequest = () => {
    if (!pvpRequest) return;
    const { fromPlayerId, toPlayerId, type } = pvpRequest;
    if (type === "battle") {
      skipEmitAfterPvpAcceptRef.current = true;
      if (socket) socket.emit("pvpAccept", { fromPlayerId, toPlayerId });
    }
    setPvpRequest(null);
    if (type !== "battle") {
      setPvpTrade({ playerAId: fromPlayerId, playerBId: toPlayerId, aSelectedIndex: null, bSelectedIndex: null });
    }
  };

  const declinePvpRequest = () => {
    setPvpRequest(null);
  };

  const endPvpBattle = (challengerLeadHp: number, defenderLeadHp: number) => {
    if (!pvpBattle) return;
    const { challengerId, defenderId } = pvpBattle;
    setPlayers((ps) =>
      ps.map((pl) => {
        if (pl.id === challengerId && pl.team[0]) {
          return { ...pl, team: [{ ...pl.team[0], hp: Math.max(0, challengerLeadHp) }, ...pl.team.slice(1)] };
        }
        if (pl.id === defenderId && pl.team[0]) {
          return { ...pl, team: [{ ...pl.team[0], hp: Math.max(0, defenderLeadHp) }, ...pl.team.slice(1)] };
        }
        return pl;
      })
    );
    setPvpBattle(null);
    setPhase("map");
  };

  const setTradeSelection = (playerId: string, index: number | null) => {
    if (!pvpTrade) return;
    const { playerAId, playerBId } = pvpTrade;
    setPvpTrade((t) =>
      !t
        ? t
        : playerId === playerAId
          ? { ...t, aSelectedIndex: index }
          : playerId === playerBId
            ? { ...t, bSelectedIndex: index }
            : t
    );
  };

  const executeTrade = () => {
    if (!pvpTrade || pvpTrade.aSelectedIndex == null || pvpTrade.bSelectedIndex == null) return;
    const { playerAId, playerBId, aSelectedIndex, bSelectedIndex } = pvpTrade;
    if (socket && roomCode && roomCode !== "SOLO") {
      socket.emit("tradeConfirm", { playerAId, playerBId, aSelectedIndex, bSelectedIndex });
    } else {
      setPlayers((ps) => {
        const a = ps.find((p) => p.id === playerAId);
        const b = ps.find((p) => p.id === playerBId);
        if (!a || !b || a.team[aSelectedIndex] == null || b.team[bSelectedIndex] == null) return ps;
        const monA = a.team[aSelectedIndex];
        const monB = b.team[bSelectedIndex];
        return ps.map((pl) => {
          if (pl.id === playerAId) {
            const newTeam = pl.team.slice();
            newTeam[aSelectedIndex] = monB;
            return { ...pl, team: newTeam };
          }
          if (pl.id === playerBId) {
            const newTeam = pl.team.slice();
            newTeam[bSelectedIndex] = monA;
            return { ...pl, team: newTeam };
          }
          return pl;
        });
      });
    }
    setPvpTrade(null);
  };

  const cancelTrade = () => {
    setPvpTrade(null);
  };

  const leaveRoom = () => {
    clearGigiEventStorage();
    setPhase("home");
    setRoomCode("");
    setPlayers([]);
    setCurrentPlayerIndex(0);
    setWildEncounter(null);
    setEncounterLog([]);
    setPendingLearn(null);
    setEvolutionNotice(null);
    setPvpRequest(null);
    setPvpBattle(null);
    setPvpTrade(null);
    setPendingReplaceCapture(null);
  };

  return {
    phase,
    setPhase,
    roomCode,
    players,
    addPlayer,
    toggleReady,
    startGameIfReady,
    selectStarter,
    selectSprite,
    currentPlayerIndex,
    setCurrentPlayerIndex,
    movePlayer,
    walkPlayer,
    setPlayerTilePos,
    setPlayerSprite,
    wildEncounter,
    setWildEncounter,
    captureAttempt,
    confirmReplaceCapture,
    pendingReplaceCapture,
    updatePlayerLead,
    updateLeadPokemon,
    healPlayer,
    whiteout,
    addBadge,
    pokedexSeen,
    pokedexCaught,
    buyPokeball,
    buyItem,
    addCoins,
    useItem,
    searchWild,
    pendingLearn,
    finalizeLearn,
    grantXpToLead,
    grantXpToParticipants,
    toggleExpShare,
    evolutionNotice,
    setEvolutionNotice,
    replaceState,
    joinError,
    setJoinError,
    pvpRequest,
    acceptPvpRequest,
    declinePvpRequest,
    requestPvpBattle,
    requestPvpTrade,
    pvpBattle,
    endPvpBattle,
    pvpTrade,
    setTradeSelection,
    executeTrade,
    cancelTrade,
    startSingleplayer,
    leaveRoom
  };
}

function usePerformanceBaseline() {
  const [metrics, setMetrics] = useState({ fps: 0, avgFrameMs: 0, players: 0 });
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();
    let sum = 0;
    const tick = (t: number) => {
      const delta = t - last;
      last = t;
      sum += delta;
      frames += 1;
      if (sum >= 1000) {
        const fps = Math.round((frames * 1000) / sum);
        const avgFrameMs = Number((sum / Math.max(1, frames)).toFixed(2));
        setMetrics((prev) => ({ ...prev, fps, avgFrameMs }));
        frames = 0;
        sum = 0;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return metrics;
}

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const game = useGameState(socket);
  const [starters, setStarters] = useState<any[] | null>(null);
  const [cityModal, setCityModal] = useState<null | { name: string; description?: string; gym?: string | null; league?: boolean }>(null);
  const [gymBattle, setGymBattle] = useState<null | { leader: string; team: any[]; index: number }>(null);
  const [gymVictory, setGymVictory] = useState<string | null>(null);
  const [leagueBattle, setLeagueBattle] = useState<null | { trainers: { name: string; team: any[] }[]; trainerIndex: number; pokemonIndex: number }>(null);
  const [leagueVictory, setLeagueVictory] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showKantoMap, setShowKantoMap] = useState(false);
  const [muted, setMuted] = useState(() => sound.isMuted());
  const [themeMuted, setThemeMuted] = useState(() => sound.isThemeMuted());
  const [achievementToast, setAchievementToast] = useState<null | (AchievementData & { id: string })>(null);
  const [showWhiteout, setShowWhiteout] = useState(false);
  const [showPokedex, setShowPokedex] = useState(false);
  const [showHallOfFame, setShowHallOfFame] = useState(false);
  const [hallOfFame, setHallOfFame] = useState<Array<{ playerName: string; team: { name: string; level: number; sprite: string }[]; date: string }>>(() => {
    try {
      const saved = localStorage.getItem("pokemon-kanto-hall-of-fame");
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [rivalBattle, setRivalBattle] = useState<null | { trainerName: string; team: any[]; index: number; location: string }>(null);
  const [defeatedTrainers, setDefeatedTrainers] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("pokemon-kanto-defeated-trainers");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [showPerfOverlay, setShowPerfOverlay] = useState(false);
  const perf = usePerformanceBaseline();

  const handleConfirmLeave = () => {
    if (socket && game.roomCode && game.roomCode !== "SOLO") socket.emit("leaveRoom");
    game.leaveRoom();
    setGymBattle(null);
    setGymVictory(null);
    setLeagueBattle(null);
    setLeagueVictory(false);
    setCityModal(null);
    setShowTeam(false);
    setShowMenu(false);
    setShowLeaveConfirm(false);
  };

  useEffect(() => {
    const s = io(WS_URL);
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    const unlock = () => sound.unlockAudio();
    document.addEventListener("click", unlock, { once: true, capture: true });
    document.addEventListener("touchstart", unlock, { once: true, capture: true });
    return () => {
      document.removeEventListener("click", unlock, { capture: true });
      document.removeEventListener("touchstart", unlock, { capture: true });
    };
  }, []);

  useEffect(() => {
    getStarters(STARTER_IDS).then((templates) => {
      const instances = templates.map((t) => makeInstanceFromTemplate(t, 5));
      setStarters(instances);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (game.phase === "home") sound.stopMusic();
    else if (!sound.isThemeMuted()) sound.startThemeMusic();
  }, [game.phase]);

  useEffect(() => {
    if (!socket) return;
    const onAchievement = (data: AchievementData) => {
      setAchievementToast({ ...data, id: `${data.ts ?? Date.now()}-${Math.random().toString(36).slice(2)}` });
    };
    socket.on("achievement", onAchievement);
    return () => { socket.off("achievement", onAchievement); };
  }, [socket]);

  const isSolo = game.roomCode === "SOLO";
  const isMultiplayer = Boolean(game.roomCode && socket && !isSolo);
  const myPlayerIndex = isMultiplayer && socket
    ? game.players.findIndex((p) => p.id === socket.id)
    : -1;
  const effectivePlayerIndex = isMultiplayer && myPlayerIndex >= 0 ? myPlayerIndex : game.currentPlayerIndex;
  const currentPlayer = game.players[effectivePlayerIndex];
  const myPlayerIdForUi = isSolo ? currentPlayer?.id : (isMultiplayer ? currentPlayer?.id : undefined);

  const isMyPvPBattle = game.pvpBattle && (socket?.id === game.pvpBattle.challengerId || socket?.id === game.pvpBattle.defenderId);
  const isMyWildBattle = game.wildEncounter && (
    !game.wildEncounter.triggeredByPlayerId ||
    game.wildEncounter.triggeredByPlayerId === socket?.id ||
    (isSolo && game.wildEncounter.triggeredByPlayerId === currentPlayer?.id)
  );
  const isMyBattle = isMyWildBattle || isMyPvPBattle;
  const effectivePhase: Phase =
    isMultiplayer && game.phase === "battle" && !isMyBattle ? "map" : game.phase;

  const viewScreen: "home" | "lobby" | "sprite" | "starter" | "map" =
    effectivePhase === "home"
      ? "home"
      : effectivePhase === "battle" && !isMyBattle
        ? "map"
        : (isMultiplayer || isSolo)
          ? (currentPlayer?.screen ?? "lobby")
          : (effectivePhase === "encounter" || effectivePhase === "battle" ? "map" : effectivePhase);

  useEffect(() => {
    if (viewScreen !== "map" || !currentPlayer) return;
    const loc = LOCATIONS[currentPlayer.location];
    const pool = loc ? getWildPool(loc) : [];
    if (!pool.length) return;
    prefetchPokemonTemplates(pool).catch(() => {});
  }, [viewScreen, currentPlayer?.location, currentPlayer?.id]);

  return (
    <div className="min-h-screen p-3 sm:p-4 pb-0">
      <header className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b-2 border-amber-500/30">
        <h1 className="text-sm sm:text-xl text-yellow-300 truncate font-bold">Pallet Town Demo</h1>
        {viewScreen !== "home" && (
          <div className="text-xs sm:text-sm text-gray-300">
            {isMultiplayer && currentPlayer ? (
              <>You: <strong>{currentPlayer.name}</strong></>
            ) : (
              <>Room: {game.roomCode || "—"}</>
            )}
          </div>
        )}
      </header>

      <main className="main-with-nav">
        {viewScreen === "home" && (
          <HomeScreen
            socket={socket}
            joinError={game.joinError}
            setJoinError={game.setJoinError}
            isLocalhost={typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")}
            startSingleplayer={game.startSingleplayer}
          />
        )}

        {viewScreen !== "home" && game.players.length > 0 && !isMultiplayer && (
          <div className="mb-4">
            <PlayerSwitcher players={game.players} current={game.currentPlayerIndex} setCurrent={game.setCurrentPlayerIndex} />
          </div>
        )}
        {viewScreen !== "home" && isMultiplayer && currentPlayer && (
          <div className="mb-2 text-xs text-gray-400">Playing as <strong className="text-yellow-300">{currentPlayer.name}</strong></div>
        )}

        {viewScreen === "lobby" && (
          <LobbyScreen
            players={game.players}
            addPlayer={game.addPlayer}
            toggleReady={game.toggleReady}
            startGame={() => game.startGameIfReady(myPlayerIdForUi)}
            roomCode={game.roomCode}
            myPlayerId={myPlayerIdForUi}
            independentStart={isMultiplayer || isSolo}
            onLeaveRoom={() => setShowLeaveConfirm(true)}
          />
        )}

        {viewScreen === "sprite" && (
          <SpriteSelectScreen
            players={game.players}
            selectSprite={game.selectSprite}
            myPlayerId={myPlayerIdForUi}
            onLeaveRoom={() => setShowLeaveConfirm(true)}
          />
        )}

        {viewScreen === "starter" && starters && currentPlayer && isSecretGigiName(currentPlayer.name) && (
          <SecretGigiEvent
            playerName={currentPlayer.name}
            onComplete={() => {
              game.selectStarter(currentPlayer!.id, EEVEE_ID);
            }}
          />
        )}
        {viewScreen === "starter" && starters && (!currentPlayer || !isSecretGigiName(currentPlayer.name)) && (
          <StarterSelectScreen
            players={game.players}
            selectStarter={game.selectStarter}
            starters={starters}
            myPlayerId={myPlayerIdForUi}
            onLeaveRoom={() => setShowLeaveConfirm(true)}
          />
        )}

        {viewScreen === "map" && (
          <PalletMapScreen
            players={game.players}
            currentPlayerIndex={effectivePlayerIndex}
            movePlayer={(playerId, to, options) => game.movePlayer(playerId, to, options)}
            setPlayerTilePos={game.setPlayerTilePos}
            setPlayerSprite={game.setPlayerSprite}
            healPlayer={game.healPlayer}
            isMultiplayer={isMultiplayer}
            myPlayerId={isSolo ? currentPlayer?.id ?? null : (isMultiplayer ? currentPlayer?.id ?? null : (socket?.id ?? null))}
            requestPvpBattle={game.requestPvpBattle}
            requestPvpTrade={game.requestPvpTrade}
            pvpBattle={game.pvpBattle}
          />
        )}
        <div id="bottom-nav-placeholder"></div>
        {cityModal && (
          <CityModal
            name={cityModal.name}
            description={cityModal.description}
            gym={cityModal.gym}
            gymLeaderSprite={cityModal.gym ? (GYM_LEADER_SPRITES[cityModal.gym] ?? null) : null}
            hasBadge={cityModal.gym ? (currentPlayer?.badges?.includes(cityModal.gym) ?? false) : false}
            league={cityModal.league}
            badgeCount={currentPlayer?.badges?.length ?? 0}
            coins={currentPlayer?.bag?.coins ?? 0}
            bag={currentPlayer?.bag as any}
            onBuyItem={(item, price) => game.buyItem(currentPlayer?.id ?? "", item as any, price)}
            onClose={() => setCityModal(null)}
            onHeal={() => game.healPlayer(currentPlayer?.id ?? "")}
            onChallenge={() => {
              const leaderKey = cityModal!.gym!;
              const badgeCount = currentPlayer?.badges?.length ?? 0;
              if (leaderKey === "Giovanni" && badgeCount < 7) return;
              const leaders: Record<string, { name: string; team: { id: number; level: number }[] }> = {
                "Brock": { name: "Brock", team: [{ id: 74, level: 12 }, { id: 95, level: 14 }] },
                "Misty": { name: "Misty", team: [{ id: 120, level: 18 }, { id: 121, level: 21 }] },
                "Lt. Surge": { name: "Lt. Surge", team: [{ id: 100, level: 21 }, { id: 25, level: 18 }, { id: 26, level: 24 }] },
                "Erika": { name: "Erika", team: [{ id: 114, level: 29 }, { id: 71, level: 29 }, { id: 45, level: 32 }] },
                "Koga": { name: "Koga", team: [{ id: 109, level: 37 }, { id: 89, level: 39 }, { id: 109, level: 37 }, { id: 110, level: 43 }] },
                "Sabrina": { name: "Sabrina", team: [{ id: 64, level: 38 }, { id: 122, level: 37 }, { id: 49, level: 38 }, { id: 65, level: 43 }] },
                "Blaine": { name: "Blaine", team: [{ id: 58, level: 42 }, { id: 77, level: 40 }, { id: 78, level: 42 }, { id: 59, level: 47 }] },
                "Giovanni": { name: "Giovanni", team: [{ id: 111, level: 45 }, { id: 51, level: 42 }, { id: 31, level: 44 }, { id: 34, level: 45 }, { id: 112, level: 50 }] }
              };
              const leader = leaders[leaderKey || ""] || leaders["Brock"];
              Promise.all(leader.team.map((m) => getPokemonTemplate(m.id).then((tpl) => makeInstanceFromTemplate(tpl, m.level)))).then((instances) => {
                setGymBattle({ leader: leader.name, team: instances, index: 0 });
                setCityModal(null);
              });
            }}
            onChallengeLeague={() => {
              Promise.all(LEAGUE_TRAINERS.map((t) =>
                Promise.all(t.team.map((m) => getPokemonTemplate(m.id).then((tpl) => makeInstanceFromTemplate(tpl, m.level)))).then((team) => ({ name: t.name, team }))
              )).then((trainers) => {
                setLeagueBattle({ trainers, trainerIndex: 0, pokemonIndex: 0 });
                setCityModal(null);
              });
            }}
          />
        )}

        {rivalBattle && currentPlayer && currentPlayer.team[0] && rivalBattle.team[rivalBattle.index] && (
          <BattleModal
            key={`rival-${rivalBattle.trainerName}-${rivalBattle.index}`}
            isTrainerBattle
            playerPokemon={currentPlayer.team[0]}
            enemyPokemon={rivalBattle.team[rivalBattle.index]}
            playerTeam={currentPlayer.team}
            locationType={(LOCATIONS[rivalBattle.location] as any)?.type ?? "grass"}
            onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
            onPlayerUpdate={(p) => { if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p); }}
            potionCount={normalizeBag(currentPlayer.bag).potion}
            superPotionCount={normalizeBag(currentPlayer.bag).superpotion}
            onUsePotion={(type) => game.useItem(currentPlayer!.id, type)}
            onEnd={async (res) => {
              if (res.winner === "player") {
                if (res.xpGain != null && res.xpGain > 0) {
                  const ids = res.participantIds?.length ? res.participantIds : (currentPlayer.team[0] ? [currentPlayer.team[0].id] : []);
                  if (ids.length) await game.grantXpToParticipants(effectivePlayerIndex, res.xpGain, ids);
                }
                if (rivalBattle.index + 1 < rivalBattle.team.length) {
                  setRivalBattle((prev) => prev ? { ...prev, index: prev.index + 1 } : null);
                } else {
                  game.addCoins(currentPlayer!.id, 5);
                  setDefeatedTrainers((prev) => {
                    const next = new Set(prev);
                    next.add(rivalBattle.location);
                    try { localStorage.setItem("pokemon-kanto-defeated-trainers", JSON.stringify([...next])); } catch {}
                    return next;
                  });
                  setRivalBattle(null);
                }
              } else {
                setRivalBattle(null);
                if (currentPlayer.team.every((m) => (m.hp ?? 0) <= 0)) {
                  game.whiteout(currentPlayer.id);
                  setShowWhiteout(true);
                }
              }
              sound.stopSfx("battle-start");
            }}
          />
        )}
        {gymVictory && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-gray-900 p-4 rounded-lg text-white max-w-sm text-center shadow-xl">
              <div className="font-bold text-yellow-300 mb-2 text-sm sm:text-base">Gym victory!</div>
              <p className="text-xs sm:text-sm mb-4">You defeated {gymVictory} and earned the badge. (+{GYM_COIN_REWARD} coins)</p>
              <button className="pixel-btn w-full" onClick={() => setGymVictory(null)}>Close</button>
            </div>
          </div>
        )}
        {game.evolutionNotice && game.evolutionNotice.playerIndex === effectivePlayerIndex && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-3 sm:p-4">
            <div className="bg-gray-900 p-4 rounded-md text-white w-full max-w-sm">
              <div className="font-bold mb-2 text-xs sm:text-base">Evolution!</div>
              <div className="mb-3 text-xs sm:text-sm">{game.evolutionNotice.oldName} evolved into {game.evolutionNotice.newName}!</div>
              <button className="pixel-btn w-full" onClick={() => game.setEvolutionNotice(null)}>Close</button>
            </div>
          </div>
        )}

        {game.phase === "battle" && game.wildEncounter && isMyBattle && !game.pvpBattle && currentPlayer && (
          <BattleModal
            playerPokemon={currentPlayer.team[0]}
            enemyPokemon={game.wildEncounter.pokemon}
            playerTeam={currentPlayer.team}
            pokeballCount={(currentPlayer.bag?.pokeball ?? 0) + (currentPlayer.bag?.greatball ?? 0) + (currentPlayer.bag?.ultraball ?? 0)}
            potionCount={normalizeBag(currentPlayer.bag).potion}
            superPotionCount={normalizeBag(currentPlayer.bag).superpotion}
            onUsePotion={(type) => game.useItem(currentPlayer!.id, type)}
            locationType={(LOCATIONS[currentPlayer.location] as any)?.type ?? "grass"}
            onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
            onEnd={async (res) => {
              if (res.winner === "player" && res.xpGain != null && res.xpGain > 0) {
                const ids = res.participantIds?.length ? res.participantIds : (currentPlayer?.team[0] ? [currentPlayer.team[0].id] : []);
                if (ids.length) await game.grantXpToParticipants(effectivePlayerIndex, res.xpGain, ids);
                game.addCoins(currentPlayer!.id, WILD_COIN_REWARD);
              }
              sound.stopSfx("battle-start");
              game.setPhase("map");
              game.setWildEncounter(null);
              if (res.winner === "enemy" && currentPlayer && currentPlayer.team.every((m) => (m.hp ?? 0) <= 0)) {
                game.whiteout(currentPlayer.id);
                setShowWhiteout(true);
              }
            }}
            onPlayerUpdate={(p) => {
              if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p);
            }}
            onCapture={() => {
              if (!game.wildEncounter || !currentPlayer) return false;
              const we = game.wildEncounter.pokemon;
              const hpFactor = 1 - (we.hp / we.maxHp);
              const chance = Math.min(0.95, 0.5 + hpFactor * 0.6);
              return game.captureAttempt(chance, currentPlayer.id);
            }}
            onGrantXp={(xp: number) => game.grantXpToLead(effectivePlayerIndex, xp)}
          />
        )}
        {gymBattle && currentPlayer && currentPlayer.team[0] && gymBattle.team[gymBattle.index] && (
          <BattleModal
            key={`gym-${gymBattle.leader}-${gymBattle.index}`}
            isTrainerBattle
            playerPokemon={currentPlayer.team[0]}
            enemyPokemon={gymBattle.team[gymBattle.index]}
            playerTeam={currentPlayer.team}
            locationType="town"
            onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
            onPlayerUpdate={(p) => { if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p); }}
            onEnd={async (res) => {
              if (res.winner === "player") {
                if (res.xpGain != null && res.xpGain > 0 && currentPlayer) {
                  const ids = res.participantIds?.length ? res.participantIds : (currentPlayer.team[0] ? [currentPlayer.team[0].id] : []);
                  if (ids.length) await game.grantXpToParticipants(effectivePlayerIndex, res.xpGain, ids);
                }
                if (gymBattle.index + 1 < gymBattle.team.length) {
                  setGymBattle((prev) => prev ? { ...prev, index: prev.index + 1 } : null);
                } else {
                  game.addBadge(currentPlayer!.id, gymBattle.leader);
                  game.addCoins(currentPlayer!.id, GYM_COIN_REWARD);
                  setGymVictory(gymBattle.leader);
                  setGymBattle(null);
                  const achievementPayload = { type: "gym" as const, playerName: currentPlayer!.name, gymLeader: gymBattle.leader };
                  if (socket && game.roomCode && game.roomCode !== "SOLO") {
                    socket.emit("achievement", achievementPayload);
                  } else {
                    setAchievementToast({ ...achievementPayload, id: `gym-${Date.now()}` });
                  }
                }
              } else {
                setGymBattle(null);
                if (currentPlayer && currentPlayer.team.every((m) => (m.hp ?? 0) <= 0)) {
                  game.whiteout(currentPlayer.id);
                  setShowWhiteout(true);
                }
              }
              sound.stopSfx("battle-start");
            }}
          />
        )}
        {leagueBattle && currentPlayer && currentPlayer.team[0] && (() => {
          const { trainers, trainerIndex, pokemonIndex } = leagueBattle;
          const trainer = trainers[trainerIndex];
          const enemy = trainer?.team[pokemonIndex];
          if (!trainer || !enemy) return null;
          return (
            <BattleModal
              key={`league-${trainer.name}-${pokemonIndex}`}
              isTrainerBattle
              playerPokemon={currentPlayer.team[0]}
              enemyPokemon={enemy}
              playerTeam={currentPlayer.team}
              locationType="town"
              onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
              onPlayerUpdate={(p) => { if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p); }}
              onEnd={async (res) => {
                if (res.winner === "player") {
                  if (res.xpGain != null && res.xpGain > 0 && currentPlayer) {
                    const ids = res.participantIds?.length ? res.participantIds : (currentPlayer.team[0] ? [currentPlayer.team[0].id] : []);
                    if (ids.length) await game.grantXpToParticipants(effectivePlayerIndex, res.xpGain, ids);
                  }
                  const nextPokemon = pokemonIndex + 1 < trainer.team.length;
                  const nextTrainer = trainerIndex + 1 < trainers.length;
                  if (nextPokemon) {
                    setLeagueBattle((prev) => prev ? { ...prev, pokemonIndex: prev.pokemonIndex + 1 } : null);
                  } else if (nextTrainer) {
                    setLeagueBattle((prev) => prev ? { ...prev, trainerIndex: prev.trainerIndex + 1, pokemonIndex: 0 } : null);
                  } else {
                    sound.playSfx("gym-victory");
                    game.addCoins(currentPlayer!.id, LEAGUE_COIN_REWARD);
                    const hofEntry = {
                      playerName: currentPlayer!.name,
                      team: currentPlayer!.team.map((m) => ({ name: m.name, level: m.level, sprite: m.sprite })),
                      date: new Date().toLocaleDateString(),
                    };
                    setHallOfFame((prev) => {
                      const next = [...prev, hofEntry];
                      try { localStorage.setItem("pokemon-kanto-hall-of-fame", JSON.stringify(next)); } catch {}
                      return next;
                    });
                    setLeagueVictory(true);
                    setLeagueBattle(null);
                    if (socket && game.roomCode && game.roomCode !== "SOLO") {
                      socket.emit("achievement", { type: "gym", playerName: currentPlayer!.name, gymLeader: "Champion" });
                    } else {
                      setAchievementToast({ type: "gym", playerName: currentPlayer!.name, gymLeader: "Champion", id: `league-${Date.now()}` });
                    }
                  }
                } else {
                  setLeagueBattle(null);
                  if (currentPlayer && currentPlayer.team.every((m) => (m.hp ?? 0) <= 0)) {
                    game.whiteout(currentPlayer.id);
                    setShowWhiteout(true);
                  }
                }
                sound.stopSfx("battle-start");
              }}
            />
          );
        })()}
        {leagueVictory && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
            <div className="bg-gray-900 p-6 rounded-lg text-white max-w-sm text-center shadow-xl border-2 border-amber-500/60">
              <div className="font-bold text-yellow-300 mb-2 text-lg">🏆 You are the Champion!</div>
              <p className="text-sm mb-2">You defeated the Elite Four and the Champion. The Pokémon League is yours!</p>
              <p className="text-xs text-gray-400 mb-4">Your team has been registered in the Hall of Fame.</p>
              <div className="flex gap-2">
                <button className="pixel-btn flex-1" onClick={() => setLeagueVictory(false)}>Close</button>
                <button className="pixel-btn pixel-btn-primary flex-1" onClick={() => { setLeagueVictory(false); setShowHallOfFame(true); }}>Hall of Fame</button>
              </div>
            </div>
          </div>
        )}
        {showWhiteout && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4">
            <div className="bg-gray-900 p-5 rounded-lg text-white max-w-xs text-center shadow-xl border-2 border-red-500/50">
              <div className="font-bold text-red-400 mb-2 text-sm sm:text-base">You blacked out!</div>
              <p className="text-xs sm:text-sm text-gray-300 mb-1">All your Pokémon fainted.</p>
              <p className="text-xs sm:text-sm text-gray-300 mb-4">You lost half your coins and rushed to the nearest city.</p>
              <button className="pixel-btn w-full" onClick={() => setShowWhiteout(false)}>OK</button>
            </div>
          </div>
        )}
        {game.phase === "battle" && game.pvpBattle && isMyPvPBattle && currentPlayer && (() => {
          const pvp = game.pvpBattle!;
          const { challengerId, defenderId } = pvp;
          const challenger = game.players.find((p) => p.id === challengerId);
          const defender = game.players.find((p) => p.id === defenderId);
          const amChallenger = socket?.id === challengerId;
          const myIdx = amChallenger ? (pvp.challengerIndex ?? 0) : (pvp.defenderIndex ?? 0);
          const theirIdx = amChallenger ? (pvp.defenderIndex ?? 0) : (pvp.challengerIndex ?? 0);
          const myLead = currentPlayer.team[myIdx];
          const theirLead = (amChallenger ? defender : challenger)?.team[theirIdx];
          if (!myLead || !theirLead) return null;
          const myHp = amChallenger ? (pvp.challengerHp ?? myLead.hp) : (pvp.defenderHp ?? myLead.hp);
          const theirHp = amChallenger ? (pvp.defenderHp ?? theirLead.hp) : (pvp.challengerHp ?? theirLead.hp);
          const myMaxHp = amChallenger ? (pvp.challengerMaxHp ?? myLead.maxHp) : (pvp.defenderMaxHp ?? myLead.maxHp);
          const theirMaxHp = amChallenger ? (pvp.defenderMaxHp ?? theirLead.maxHp) : (pvp.challengerMaxHp ?? theirLead.maxHp);
          const iMustSwitch = pvp.status === "waiting_switch" && ((pvp.mustSwitch === "challenger") === amChallenger);
          return (
            <BattleModal
              isPvP
              playerPokemon={{ ...myLead, hp: myHp, maxHp: myMaxHp }}
              enemyPokemon={{ ...theirLead, hp: theirHp, maxHp: theirMaxHp }}
              playerTeam={currentPlayer.team}
              locationType={(LOCATIONS[currentPlayer.location] as any)?.type ?? "town"}
              pvpBattleState={pvp.status ? {
                log: pvp.log ?? [],
                status: pvp.status,
                winner: pvp.winner,
                mustSwitch: iMustSwitch,
                myMoveSubmitted: amChallenger ? pvp.challengerMove != null : pvp.defenderMove != null,
              } : undefined}
              pvpYouWon={pvp.winner != null && (pvp.winner === "challenger") === amChallenger}
              onPvpSubmitMove={(moveName) => socket?.emit("pvpSubmitMove", { kind: "move", moveName })}
              onSwitchPokemon={(i) => socket?.emit("pvpSubmitMove", { kind: "switch", index: i })}
              onEnd={(res) => {
                sound.stopSfx("battle-start");
                if (res.playerFinalHp != null && res.enemyFinalHp != null) {
                  const chHp = amChallenger ? res.playerFinalHp : res.enemyFinalHp;
                  const defHp = amChallenger ? res.enemyFinalHp : res.playerFinalHp;
                  if (socket) socket.emit("pvpEnd", { challengerHp: chHp, defenderHp: defHp });
                  game.endPvpBattle(res.playerFinalHp, res.enemyFinalHp);
                } else {
                  game.endPvpBattle(myLead.hp, theirLead.hp);
                }
              }}
              onPlayerUpdate={(p) => {
                if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p);
              }}
            />
          );
        })()}
        {game.pvpRequest && game.pvpRequest.toPlayerId === socket?.id && (() => {
          const from = game.players.find((p) => p.id === game.pvpRequest!.fromPlayerId);
          const type = game.pvpRequest!.type;
          return (
            <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4">
              <div className="bg-gray-900 rounded-lg p-4 max-w-sm w-full text-white shadow-xl">
                <p className="text-sm sm:text-base mb-4">
                  <strong className="text-yellow-300">{from?.name ?? "Someone"}</strong> wants to {type === "battle" ? "battle" : "trade"} with you!
                </p>
                <div className="flex gap-2">
                  <button className="pixel-btn flex-1" onClick={() => game.acceptPvpRequest()}>Accept</button>
                  <button className="pixel-btn flex-1" onClick={() => game.declinePvpRequest()}>Decline</button>
                </div>
              </div>
            </div>
          );
        })()}
        {game.pvpTrade && (socket?.id === game.pvpTrade.playerAId || socket?.id === game.pvpTrade.playerBId) && (() => {
          const trade = game.pvpTrade;
          const meId = socket!.id;
          const myIndex = meId === trade!.playerAId ? "a" : "b";
          const mySelection = myIndex === "a" ? trade!.aSelectedIndex : trade!.bSelectedIndex;
          const theirSelection = myIndex === "a" ? trade!.bSelectedIndex : trade!.aSelectedIndex;
          const myTeam = game.players.find((p) => p.id === meId)?.team ?? [];
          const theirId = myIndex === "a" ? trade!.playerBId : trade!.playerAId;
          const theirPlayer = game.players.find((p) => p.id === theirId);
          const theirTeam = theirPlayer?.team ?? [];
          const theirMon = theirSelection != null ? theirTeam[theirSelection] : null;
          const canConfirm = trade!.aSelectedIndex != null && trade!.bSelectedIndex != null;
          return (
            <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4">
              <div className="bg-gray-900 rounded-lg p-4 max-w-sm w-full text-white shadow-xl max-h-[90vh] overflow-y-auto border-2 border-amber-500/30">
                <h3 className="text-base font-bold text-yellow-300 mb-3">Trade Pokémon</h3>
                <p className="text-xs text-gray-400 mb-2">Choose one of your Pokémon to offer:</p>
                <div className="space-y-1.5 mb-4">
                  {myTeam.map((pk, i) => (
                    <button
                      key={i}
                      className={`w-full flex items-center gap-2 p-2 rounded bg-gray-700 hover:bg-gray-600 text-left transition ${mySelection === i ? "ring-2 ring-yellow-400 bg-amber-900/30" : ""}`}
                      onClick={() => game.setTradeSelection(meId, mySelection === i ? null : i)}
                    >
                      <img src={pk.sprite} className="w-10 h-10" alt={pk.name} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-bold truncate">{pk.name}</div>
                        <div className="text-[10px] text-gray-400">Lv{pk.level} · HP {pk.hp}/{pk.maxHp}</div>
                      </div>
                      {mySelection === i && <span className="text-yellow-400 text-xs font-bold">Offering</span>}
                    </button>
                  ))}
                </div>
                <div className="border-t border-gray-600/50 pt-3 mb-3">
                  <p className="text-xs text-gray-400 mb-2">{theirPlayer?.name ?? "Other player"} offers:</p>
                  {theirMon ? (
                    <div className="flex items-center gap-2 p-2 rounded bg-gray-700">
                      <img src={theirMon.sprite} className="w-10 h-10" alt={theirMon.name} />
                      <div>
                        <div className="text-sm font-bold">{theirMon.name}</div>
                        <div className="text-[10px] text-gray-400">Lv{theirMon.level}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-gray-500 italic p-2">Waiting for selection...</div>
                  )}
                </div>
                <div className="flex gap-2">
                  <button className="pixel-btn flex-1" onClick={() => game.cancelTrade()}>Cancel</button>
                  <button className="pixel-btn pixel-btn-primary flex-1" disabled={!canConfirm} onClick={() => game.executeTrade()}>
                    {canConfirm ? "Confirm trade" : "Waiting..."}
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
        {showTeam && currentPlayer && <TeamPanel player={currentPlayer} onClose={() => setShowTeam(false)} onSetLead={(i)=>{ game.updatePlayerLead(currentPlayer.id, i); setShowTeam(false); }} />}
        {achievementToast && (
          <AchievementToast
            key={achievementToast.id}
            data={achievementToast}
            onClose={() => setAchievementToast(null)}
          />
        )}
        {showLeaveConfirm && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center modal-backdrop p-4" role="dialog" aria-modal="true" aria-labelledby="leave-confirm-title">
            <div className="card-panel p-4 w-full max-w-xs border-2 border-amber-500/40" onClick={(e) => e.stopPropagation()}>
              <h2 id="leave-confirm-title" className="section-title mb-2">Leave room?</h2>
              <p className="text-muted text-xs sm:text-sm mb-4">Your progress is saved. You can rejoin with the same name and room code.</p>
              <div className="flex gap-2">
                <button type="button" className="pixel-btn flex-1" onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
                <button type="button" className="pixel-btn flex-1 text-red-300 border-red-500/50 hover:bg-red-900/30" onClick={handleConfirmLeave}>Confirm</button>
              </div>
            </div>
          </div>
        )}
        {showMenu && (
          <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4" onClick={() => setShowMenu(false)}>
            <div className="card-panel p-4 w-full max-w-xs border-2 border-amber-500/40" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-sm text-amber-300">☰ Menu</span>
                <button type="button" className="pixel-btn text-xs" onClick={() => setShowMenu(false)}>Close</button>
              </div>
              {game.roomCode && game.roomCode !== "SOLO" && (
                <p className="text-xs text-gray-300 mb-3 pb-2 border-b border-gray-600/50">
                  Room: <strong className="text-amber-400">{game.roomCode}</strong>
                </p>
              )}
              <label className="flex items-center justify-between gap-2 cursor-pointer">
                <span className="text-xs sm:text-sm text-gray-300">Sound effects</span>
                <button
                  type="button"
                  className={`pixel-btn text-xs min-w-[70px] ${muted ? "opacity-70" : "pixel-btn-primary"}`}
                  onClick={() => { sound.toggleMute(); setMuted(sound.isMuted()); }}
                >
                  {muted ? "Off" : "On"}
                </button>
              </label>
              <label className="flex items-center justify-between gap-2 cursor-pointer mt-2">
                <span className="text-xs sm:text-sm text-gray-300">Theme music</span>
                <button
                  type="button"
                  className={`pixel-btn text-xs min-w-[70px] ${themeMuted ? "opacity-70" : "pixel-btn-primary"}`}
                  onClick={() => {
                    sound.toggleThemeMuted();
                    setThemeMuted(sound.isThemeMuted());
                    if (!sound.isThemeMuted() && game.phase !== "home") sound.startThemeMusic();
                  }}
                >
                  {themeMuted ? "Off" : "On"}
                </button>
              </label>
              {currentPlayer && (
                <label className="flex items-center justify-between gap-2 cursor-pointer mt-2">
                  <span className="text-xs sm:text-sm text-gray-300">Exp Share</span>
                  <button
                    type="button"
                    className={`pixel-btn text-xs min-w-[70px] ${currentPlayer.expShare === false ? "opacity-70" : "pixel-btn-primary"}`}
                    onClick={() => game.toggleExpShare(effectivePlayerIndex)}
                  >
                    {currentPlayer.expShare !== false ? "On" : "Off"}
                  </button>
                </label>
              )}
              {currentPlayer && (
                <button type="button" className="pixel-btn text-xs mt-2 w-full" onClick={() => { setShowPokedex(true); setShowMenu(false); }}>
                  📖 Pokédex ({currentPlayer.pokedex?.caught?.length ?? 0}/151)
                </button>
              )}
              {hallOfFame.length > 0 && (
                <button type="button" className="pixel-btn text-xs mt-2 w-full" onClick={() => { setShowHallOfFame(true); setShowMenu(false); }}>
                  🏆 Hall of Fame ({hallOfFame.length})
                </button>
              )}
              <button type="button" className="pixel-btn text-xs mt-2 w-full" onClick={() => setShowPerfOverlay((v) => !v)}>
                {showPerfOverlay ? "Hide" : "Show"} mobile perf baseline
              </button>
              <p className="text-[10px] text-gray-400 mt-1">Targets: FPS at least 55, avg frame at most 18ms during map movement.</p>
              {!muted && (
                <button type="button" className="pixel-btn text-xs mt-2 w-full" onClick={() => sound.playSfx("battle-start")}>
                  Test sound (battle-start.mp3)
                </button>
              )}
              {game.roomCode && (
                <div className="mt-4 pt-3 border-t border-gray-600/50">
                  <button
                    type="button"
                    className="pixel-btn w-full text-xs text-red-300 border-red-500/50 hover:bg-red-900/30"
                    onClick={() => setShowLeaveConfirm(true)}
                  >
                    Leave room
                  </button>
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-3">Put your .mp3 in <code className="bg-gray-800 px-1 rounded">public/sounds/</code>: battle-start, capture, level-up, evolution, achievement, gym-victory</p>
            </div>
          </div>
        )}
        {showHallOfFame && (
          <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-2 sm:p-4 overflow-y-auto">
            <div className="card-panel p-4 w-full max-w-md border-2 border-amber-500/40 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <span className="font-bold text-sm text-yellow-300">🏆 Hall of Fame</span>
                <button type="button" className="pixel-btn text-xs" onClick={() => setShowHallOfFame(false)}>Close</button>
              </div>
              <div className="overflow-y-auto flex-1 min-h-0 space-y-3">
                {hallOfFame.map((entry, i) => (
                  <div key={i} className="bg-black/30 rounded-lg p-3 border border-amber-600/30">
                    <div className="text-xs text-amber-300 font-bold mb-1">{entry.playerName} — {entry.date}</div>
                    <div className="flex gap-2 flex-wrap">
                      {entry.team.map((mon, j) => (
                        <div key={j} className="flex flex-col items-center">
                          <img src={mon.sprite} alt={mon.name} className="w-10 h-10" loading="lazy" />
                          <span className="text-[8px] text-gray-400">{mon.name} Lv{mon.level}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {hallOfFame.length === 0 && <p className="text-xs text-gray-500 text-center">No champions yet.</p>}
              </div>
            </div>
          </div>
        )}
        {showPokedex && currentPlayer && (
          <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-2 sm:p-4 overflow-y-auto">
            <div className="card-panel p-4 w-full max-w-lg border-2 border-amber-500/40 max-h-[90vh] flex flex-col">
              <div className="flex items-center justify-between mb-3 flex-shrink-0">
                <span className="font-bold text-sm text-amber-300">📖 Pokédex — {currentPlayer.pokedex?.caught?.length ?? 0} caught / {currentPlayer.pokedex?.seen?.length ?? 0} seen</span>
                <button type="button" className="pixel-btn text-xs" onClick={() => setShowPokedex(false)}>Close</button>
              </div>
              <div className="grid grid-cols-6 sm:grid-cols-9 gap-1 overflow-y-auto flex-1 min-h-0">
                {Array.from({ length: 151 }, (_, i) => i + 1).map((id) => {
                  const dex = currentPlayer!.pokedex ?? { seen: [], caught: [] };
                  const caught = dex.caught.includes(id);
                  const seen = dex.seen.includes(id);
                  return (
                    <div key={id} className={`relative w-full aspect-square rounded flex items-center justify-center ${caught ? "bg-green-900/40 border border-green-600/40" : seen ? "bg-gray-700/60 border border-gray-500/30" : "bg-gray-900/60 border border-gray-800/30"}`} title={caught || seen ? `#${id}` : "???"}>
                      {(caught || seen) ? (
                        <img src={`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`} alt={`#${id}`} className={`w-full h-full object-contain ${seen && !caught ? "opacity-30 grayscale" : ""}`} loading="lazy" />
                      ) : (
                        <span className="text-[8px] text-gray-600">{id}</span>
                      )}
                      {caught && <span className="absolute bottom-0 right-0 text-[6px] text-green-400">✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {game.pendingReplaceCapture && game.pendingReplaceCapture.playerIndex === effectivePlayerIndex && currentPlayer && (() => {
          const pending = game.pendingReplaceCapture!;
          const team = game.players[pending.playerIndex]?.team ?? [];
          if (team.length === 0) return null;
          return (
            <div className="fixed inset-0 z-[60] flex items-center justify-center modal-backdrop p-4">
              <div className="card-panel p-4 max-w-sm w-full border-2 border-amber-500/50">
                <div className="text-sm font-bold text-amber-300 mb-2">Team full (max 6)</div>
                <p className="text-xs text-gray-300 mb-3">Choose a Pokémon to replace. The new {pending.pokemon.name} will take its place; the chosen one will be released.</p>
                <div className="space-y-2">
                  {team.map((mon, i) => (
                    <button
                      key={`${mon.id}-${i}`}
                      type="button"
                      className="pixel-btn w-full flex items-center gap-2 text-left"
                      onClick={() => game.confirmReplaceCapture(i)}
                    >
                      <img src={mon.sprite} alt="" className="w-10 h-10 flex-shrink-0 rounded bg-gray-800" />
                      <span className="text-xs sm:text-sm truncate">{mon.name} Lv{mon.level}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        {game.pendingLearn && game.pendingLearn.playerIndex === effectivePlayerIndex && (() => {
          const pl = game.players[game.pendingLearn!.playerIndex];
          const mon = pl?.team[game.pendingLearn!.pokemonIndex];
          if (!mon) return null;
          return <LearnMoveModal pokemonName={mon.name} currentMoves={mon.moves ?? []} newMove={game.pendingLearn!.newMove} onReplace={(i:number)=>{ game.finalizeLearn(i); }} onSkip={()=>{ game.finalizeLearn(null); }} />;
        })()}
      </main>
      {viewScreen === "map" && (
        <BottomNav onTeam={() => setShowTeam(true)} onMap={() => setShowKantoMap(true)} onMenu={() => setShowMenu((s)=>!s)} />
      )}
      {showKantoMap && viewScreen === "map" && currentPlayer && (
        <KantoMapView
          locations={LOCATIONS as Record<string, { type: "town" | "grass" | "water" | "cave"; connections: string[]; x: number; y: number; gym?: string | null }>}
          currentLocation={currentPlayer.location}
          otherPlayers={game.players.filter((p) => p.id !== currentPlayer!.id && p.location).map((p) => ({ name: p.name, color: p.color, location: p.location }))}
          onClose={() => setShowKantoMap(false)}
        />
      )}
      {showPerfOverlay && (
        <div className="fixed top-2 right-2 z-[80] bg-black/80 border border-amber-500/40 rounded px-2 py-1 text-[10px] text-amber-200 pointer-events-none">
          <div>FPS: {perf.fps}</div>
          <div>Frame: {perf.avgFrameMs}ms</div>
          <div>Players: {game.players.length}</div>
          <div>Phase: {game.phase}</div>
        </div>
      )}
    </div>
  );
}

function PlayerSwitcher({ players, current, setCurrent }: { players: Player[]; current: number; setCurrent: (n: number) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {players.map((p, i) => (
        <button key={p.id} className={`pixel-btn flex-1 min-w-0 text-[10px] sm:text-xs ${i === current ? "ring-2 ring-yellow-400" : ""}`} onClick={() => setCurrent(i)}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

function HomeScreen({
  socket,
  joinError,
  setJoinError,
  isLocalhost,
  startSingleplayer
}: {
  socket: Socket | null;
  joinError: string | null;
  setJoinError: (v: string | null) => void;
  isLocalhost?: boolean;
  startSingleplayer?: (name: string) => void;
}) {
  const [createName, setCreateName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");

  const handleCreate = () => {
    if (!socket) return;
    socket.emit("createRoom", (createName || "Player 1").trim() || "Player 1");
  };

  const handleJoin = () => {
    if (!socket) return;
    setJoinError(null);
    socket.emit("joinRoom", { code: joinCode.trim(), playerName: (joinName || "Player").trim() || "Player" });
  };

  const handlePlayAlone = () => {
    startSingleplayer?.((createName || "Player 1").trim() || "Player 1");
  };

  return (
    <div className="max-w-md mx-auto space-y-5">
      <h2 className="section-title text-sm sm:text-base mb-1">Create or join a room</h2>

      {isLocalhost && startSingleplayer && (
        <div className="p-4 card-panel border border-amber-500/40 rounded-gameLg">
          <h3 className="section-title">Singleplayer (localhost)</h3>
          <p className="text-muted mb-3">Play alone to test the game. No room code needed.</p>
          <input
            className="input-pixel w-full mb-3 text-sm"
            placeholder="Your name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            aria-label="Your name"
          />
          <button type="button" className="pixel-btn pixel-btn-primary w-full" onClick={handlePlayAlone}>
            Play alone
          </button>
        </div>
      )}

      <div className="p-4 card-panel rounded-gameLg">
        <h3 className="section-title">Create room</h3>
        <input
          className="input-pixel w-full mb-3 text-sm"
          placeholder="Your name"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
          aria-label="Your name"
        />
        <button type="button" className="pixel-btn w-full" onClick={handleCreate} disabled={!socket}>
          {socket ? "Create room" : "Connecting to server…"}
        </button>
        <p className="text-muted mt-2">You’ll get a code to share. Open another browser (or incognito), join with that code, pick a starter, then you should see each other in Pallet Town.</p>
      </div>

      <div className="p-4 card-panel rounded-gameLg">
        <h3 className="section-title">Join room</h3>
        <input
          className="input-pixel w-full mb-2 text-sm"
          placeholder="Room code"
          value={joinCode}
          onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
          aria-label="Room code"
        />
        <input
          className="input-pixel w-full mb-3 text-sm"
          placeholder="Your name"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
          aria-label="Your name"
        />
        <button type="button" className="pixel-btn w-full" onClick={handleJoin} disabled={!socket}>
          Join room
        </button>
        {joinError && <p className="text-red-400 text-xs mt-2" role="alert">{joinError}</p>}
      </div>
    </div>
  );
}

function LobbyScreen({ players, addPlayer, toggleReady, startGame, roomCode, myPlayerId, independentStart, onLeaveRoom }: { players: Player[]; addPlayer: (name: string) => void; toggleReady: (id: string) => void; startGame: () => void; roomCode?: string; myPlayerId?: string; independentStart?: boolean; onLeaveRoom?: () => void }) {
  const [name, setName] = useState("");
  const canStart = independentStart ? players.length > 0 : (players.length > 0 && (players.every((p) => p.isReady) || players.length === 1));
  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="section-title mb-0">Lobby</h2>
          {roomCode && (
            <p className="text-amber-300 text-[10px] sm:text-xs mt-1">
              {roomCode === "SOLO" ? "Singleplayer" : (
                <>
                  Share code: <strong className="text-amber-200 tracking-widest">{roomCode}</strong>
                  {" "}
                  <button
                    type="button"
                    className="underline text-amber-100"
                    onClick={() => navigator.clipboard?.writeText(roomCode).catch(() => {})}
                  >
                    copy
                  </button>
                </>
              )}
            </p>
          )}
        {independentStart && roomCode && roomCode !== "SOLO" && (
          <p className="text-muted mt-1">Start when you want — you don’t need others to be ready.</p>
        )}
        </div>
        {onLeaveRoom && roomCode && (
          <button type="button" className="pixel-btn text-xs text-red-300 border-red-500/50 hover:bg-red-900/30 flex-shrink-0" onClick={onLeaveRoom}>Leave room</button>
        )}
      </div>
        {myPlayerId == null && (
        <div className="flex flex-col sm:flex-row gap-2 mb-3">
          <input className="input-pixel flex-1 text-sm" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="pixel-btn" onClick={() => { if (name.trim()) { addPlayer(name.trim()); setName(""); } }}>Add Player</button>
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {players.map((p) => (
          <div key={p.id ?? p.name} className="card-panel p-3 rounded-gameLg">
            <p className="text-xs sm:text-sm truncate text-white">{p.name} <span className="text-muted">({p.color})</span></p>
            <div className="mt-2">
              {myPlayerId == null ? (
                <button type="button" className="pixel-btn w-full sm:w-auto" onClick={() => toggleReady(p.id)}>{p.isReady ? "UNREADY" : "READY"}</button>
              ) : p.id === myPlayerId ? (
                <button type="button" className="pixel-btn w-full sm:w-auto" onClick={() => toggleReady(p.id)}>{p.isReady ? "UNREADY" : "READY"}</button>
              ) : (
                <span className="text-muted text-xs">{p.isReady ? "Ready" : "Not ready"}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        {!independentStart && players.length > 0 && (
          <p className="text-muted mb-2">
            {players.every((p) => p.isReady)
              ? "Everyone is ready!"
              : `${players.filter((p) => p.isReady).length}/${players.length} ready`}
          </p>
        )}
        <button
          className="pixel-btn pixel-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          type="button"
          onClick={startGame}
          disabled={!canStart}
        >
          Start Game
        </button>
      </div>
    </div>
  );
}

function OverworldSpritePreview({ sheetUrl, frameCols }: { sheetUrl: string; frameCols: number }) {
  const frameW = 16;
  const frameH = 32;
  const scale = 3;
  return (
    <div
      className="mx-auto overflow-hidden"
      style={{ width: frameW * scale, height: frameH * scale, imageRendering: "pixelated" }}
    >
      <img
        src={sheetUrl}
        alt=""
        style={{
          width: frameCols * frameW * scale,
          height: frameH * scale,
          objectFit: "none",
          objectPosition: "0 0",
          imageRendering: "pixelated",
          display: "block",
        }}
      />
    </div>
  );
}

function SpriteSelectScreen({
  players,
  selectSprite,
  myPlayerId,
  onLeaveRoom,
}: {
  players: Player[];
  selectSprite: (playerId: string, spriteId: string) => void;
  myPlayerId?: string;
  onLeaveRoom?: () => void;
}) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="section-title text-sm sm:text-base">Choose your character</h2>
        {onLeaveRoom && (
          <button type="button" className="pixel-btn text-xs text-red-300 border-red-500/50 hover:bg-red-900/30" onClick={onLeaveRoom}>
            Leave room
          </button>
        )}
      </div>
      <p className="text-xs text-gray-400 mb-4">Sprites from Pokémon FireRed overworld NPC sheets.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {PLAYER_SPRITE_PRESETS.map((preset) => (
          <div key={preset.id} className="p-3 bg-gray-800 rounded-md text-center border border-gray-700/60">
            <OverworldSpritePreview sheetUrl={preset.sheetUrl} frameCols={preset.frameCols} />
            <div className="mt-2 text-xs sm:text-sm">{preset.label}</div>
            <div className="mt-2 flex flex-col gap-2">
              {myPlayerId != null ? (
                <button className="pixel-btn w-full text-xs" onClick={() => selectSprite(myPlayerId, preset.id)}>
                  Pick
                </button>
              ) : (
                players.map((p) => (
                  <button key={p.id} className="pixel-btn w-full text-xs" onClick={() => selectSprite(p.id, preset.id)}>
                    Pick as {p.name}
                  </button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StarterSelectScreen({ players, selectStarter, starters, myPlayerId, onLeaveRoom }: { players: Player[]; selectStarter: (playerId: string, starterId: number) => void; starters: any[]; myPlayerId?: string; onLeaveRoom?: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="section-title text-sm sm:text-base">Choose your starter</h2>
        {onLeaveRoom && (
          <button type="button" className="pixel-btn text-xs text-red-300 border-red-500/50 hover:bg-red-900/30" onClick={onLeaveRoom}>Leave room</button>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-4">
        {starters.map((s) => (
          <div key={s.id} className="p-3 bg-gray-800 rounded-md text-center">
            <img src={s.sprite} alt={s.name} className="w-20 h-20 sm:w-24 sm:h-24 mx-auto" />
            <div className="mt-2 text-xs sm:text-base">{s.name}</div>
            <div className="mt-2 flex flex-col sm:flex-row sm:flex-wrap gap-2">
              {myPlayerId != null ? (
                <button className="pixel-btn w-full" onClick={() => selectStarter(myPlayerId, s.id)}>Pick</button>
              ) : (
                players.map((p) => (
                  <button key={p.id} className="pixel-btn w-full sm:w-auto" onClick={() => selectStarter(p.id, s.id)}>Pick as {p.name}</button>
                ))
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
