import React, { useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import { getPokemonTemplate, getStarters, makeInstanceFromTemplate, getMovesForLevel, getMovesLearnedAtLevel, getNextEvolution, xpToNextForLevel } from "./api/pokeapi";
import * as sound from "./audio/sound";
import BottomNav from "./components/BottomNav";
import TeamPanel from "./components/TeamPanel";
import LearnMoveModal from "./components/LearnMoveModal";
import BattleModal from "./components/BattleModal";
import CityModal from "./components/CityModal";
import AchievementToast, { type AchievementData } from "./components/AchievementToast";
import KantoMapView from "./components/KantoMapView";

const WS_URL = (import.meta.env.VITE_WS_URL && String(import.meta.env.VITE_WS_URL).trim()) || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
const SOLO_SAVE_KEY = "pokemon-kanto-solo";

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
};

export type PlayerScreen = "lobby" | "starter" | "map";

type Player = {
  id: string;
  name: string;
  color: string;
  isHost?: boolean;
  isReady?: boolean;
  screen?: PlayerScreen;
  location: string;
  team: Pokemon[];
  badges: string[];
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
  log?: string[];
  status?: "waiting_moves" | "resolving" | "ended";
  challengerMove?: string | null;
  defenderMove?: string | null;
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
};

const STARTER_IDS = [1, 4, 7];

const LOCATIONS: Record<string, { type: "town" | "grass" | "water" | "cave"; connections: string[]; wildPool?: number[]; gym?: string | null; x: number; y: number }> = {
  "Pallet Town": { type: "town", connections: ["Route 1"], gym: null, x: 18, y: 70 },
  "Route 1": { type: "grass", connections: ["Pallet Town", "Viridian City"], wildPool: [16, 19, 21], gym: null, x: 18, y: 58 },
  "Viridian City": { type: "town", connections: ["Route 1", "Route 2"], gym: null, x: 18, y: 44 },
  "Route 2": { type: "grass", connections: ["Viridian City", "Pewter City"], wildPool: [16, 19, 21], gym: null, x: 28, y: 36 },
  "Pewter City": { type: "town", connections: ["Route 2", "Mt. Moon"], gym: "Brock", x: 38, y: 28 },
  "Mt. Moon": { type: "cave", connections: ["Pewter City", "Route 4"], wildPool: [74, 41, 35], gym: null, x: 44, y: 36 },
  "Route 4": { type: "grass", connections: ["Mt. Moon", "Cerulean City"], wildPool: [16, 21], gym: null, x: 52, y: 36 },
  "Cerulean City": { type: "town", connections: ["Route 4", "Route 24", "Route 5"], gym: "Misty", x: 62, y: 30 },
  "Route 24": { type: "grass", connections: ["Cerulean City", "Route 25"], wildPool: [43, 60], gym: null, x: 68, y: 28 },
  "Route 25": { type: "grass", connections: ["Route 24", "Bill's Sea Cottage"], wildPool: [43, 60], gym: null, x: 74, y: 26 },
  "Bill's Sea Cottage": { type: "town", connections: ["Route 25"], gym: null, x: 78, y: 22 },
  "Route 5": { type: "grass", connections: ["Cerulean City", "Vermilion City"], wildPool: [60, 118], gym: null, x: 68, y: 40 },
  "Vermilion City": { type: "town", connections: ["Route 5", "Route 11"], gym: "Lt. Surge", x: 78, y: 52 },
  "Route 11": { type: "grass", connections: ["Vermilion City", "Route 12"], wildPool: [129, 60], gym: null, x: 82, y: 44 },
  "Route 12": { type: "grass", connections: ["Route 11", "Lavender Town"], wildPool: [129, 118], gym: null, x: 86, y: 36 },
  "Lavender Town": { type: "town", connections: ["Route 12", "Route 10"], gym: null, x: 86, y: 26 },
  "Route 10": { type: "grass", connections: ["Lavender Town", "Cerulean City"], wildPool: [41, 60], gym: null, x: 74, y: 34 },
  "Route 7": { type: "grass", connections: ["Lavender Town", "Celadon City"], wildPool: [43, 60], gym: null, x: 68, y: 44 },
  "Route 8": { type: "grass", connections: ["Lavender Town", "Celadon City"], wildPool: [43, 60], gym: null, x: 64, y: 50 },
  "Celadon City": { type: "town", connections: ["Route 7", "Route 9", "Route 16"], gym: "Erika", x: 58, y: 50 },
  "Route 9": { type: "grass", connections: ["Celadon City", "Lavender Town"], wildPool: [43, 60], gym: null, x: 66, y: 34 },
  "Route 16": { type: "grass", connections: ["Celadon City", "Route 17"], wildPool: [111, 115], gym: null, x: 60, y: 58 },
  "Route 17": { type: "grass", connections: ["Route 16", "Route 18"], wildPool: [111, 115], gym: null, x: 64, y: 64 },
  "Route 18": { type: "grass", connections: ["Route 17", "Fuchsia City"], wildPool: [111, 115], gym: null, x: 68, y: 74 },
  "Fuchsia City": { type: "town", connections: ["Route 18", "Route 19"], gym: "Koga", x: 72, y: 78 },
  "Route 19": { type: "water", connections: ["Fuchsia City", "Cinnabar Island"], wildPool: [129, 118], gym: null, x: 50, y: 86 },
  "Route 20": { type: "water", connections: ["Fuchsia City", "Cinnabar Island"], wildPool: [129, 118], gym: null, x: 60, y: 86 },
  "Cinnabar Island": { type: "town", connections: ["Route 19", "Route 21"], gym: "Blaine", x: 30, y: 92 },
  "Route 21": { type: "grass", connections: ["Cinnabar Island", "Pallet Town"], wildPool: [129, 74], gym: null, x: 22, y: 82 },
  "Route 13": { type: "grass", connections: ["Fuchsia City", "Route 14"], wildPool: [111, 123], gym: null, x: 68, y: 72 },
  "Route 14": { type: "grass", connections: ["Route 13", "Route 15"], wildPool: [111, 123], gym: null, x: 70, y: 68 },
  "Route 15": { type: "grass", connections: ["Route 14", "Lavender Town"], wildPool: [111, 123], gym: null, x: 74, y: 58 },
  "Saffron City": { type: "town", connections: ["Celadon City", "Route 6"], gym: "Sabrina", x: 66, y: 48 },
  "Route 6": { type: "grass", connections: ["Saffron City", "Vermilion City"], wildPool: [60, 118], gym: null, x: 72, y: 44 },
  "Viridian Gym": { type: "town", connections: ["Viridian City"], gym: "Giovanni", x: 18, y: 36 },
  "Indigo Plateau": { type: "town", connections: ["Viridian Gym"], gym: null, x: 28, y: 10 }
};

const GYM_LEADER_SPRITES: Record<string, string> = {
  "Brock": "https://play.pokemonshowdown.com/sprites/trainers/gen1/brock.png",
  "Misty": "https://play.pokemonshowdown.com/sprites/trainers/gen1/misty.png",
  "Lt. Surge": "https://play.pokemonshowdown.com/sprites/trainers/gen1/surge.png",
  "Erika": "https://play.pokemonshowdown.com/sprites/trainers/gen1/erika.png",
  "Koga": "https://play.pokemonshowdown.com/sprites/trainers/gen1/koga.png",
  "Sabrina": "https://play.pokemonshowdown.com/sprites/trainers/gen1/sabrina.png",
  "Blaine": "https://play.pokemonshowdown.com/sprites/trainers/gen1/blaine.png",
  "Giovanni": "https://play.pokemonshowdown.com/sprites/trainers/gen1/giovanni.png"
};

const LOCATION_TYPE_LABELS: Record<string, { icon: string; label: string; bg: string }> = {
  town: { icon: "🏠", label: "City", bg: "bg-amber-900/50" },
  grass: { icon: "🌿", label: "Route", bg: "bg-green-900/50" },
  water: { icon: "🌊", label: "Water", bg: "bg-blue-900/50" },
  cave: { icon: "⛰", label: "Cave", bg: "bg-stone-700/50" }
};

// Layout rows for grid rendering (rows of location names)
const MAP_ROWS: string[][] = [
  ["Indigo Plateau", "Pewter City", "Cerulean City", "Lavender Town"],
  ["Viridian Gym", "Viridian City", "Celadon City", "Saffron City"],
  ["Pallet Town", "Route 1", "Route 4", "Route 10"],
  ["Route 21", "Route 2", "Route 5", "Route 11"],
  ["Cinnabar Island", "Route 12", "Route 16", "Vermilion City"],
  ["Route 13", "Route 14", "Route 15", "Fuchsia City"]
];

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
  const skipEmitRef = useRef(false);
  const skipEmitAfterPvpAcceptRef = useRef(false);
  const myBattleRef = useRef<{ phase: Phase; wildEncounter: typeof wildEncounter }>({ phase: "home", wildEncounter: null });
  const playersLengthRef = useRef(0);
  myBattleRef.current = { phase, wildEncounter };
  playersLengthRef.current = players.length;

  // Restore solo game after tab was killed (e.g. minimize on mobile)
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(SOLO_SAVE_KEY) : null;
      if (!raw) return;
      const data = JSON.parse(raw) as { roomCode?: string; phase?: Phase; players?: Player[]; currentPlayerIndex?: number };
      if (data?.roomCode === "SOLO" && Array.isArray(data.players) && data.players.length > 0) {
        setRoomCode("SOLO");
        setPhase(data.phase === "battle" ? "map" : (data.phase || "map"));
        setPlayers(data.players);
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
    try {
      const toSave = phase === "battle" ? "map" : phase;
      localStorage.setItem(SOLO_SAVE_KEY, JSON.stringify({ roomCode, phase: toSave, players, currentPlayerIndex }));
    } catch {
      // ignore quota / private mode
    }
  }, [roomCode, phase, players, currentPlayerIndex]);

  const replaceState = (s: GameStateSnapshot) => {
    skipEmitRef.current = true;
    skipEmitAfterPvpAcceptRef.current = false;
    const inMyBattle = socket && myBattleRef.current.wildEncounter?.triggeredByPlayerId === socket.id;
    const incomingClearsBattle = s.phase !== "battle" || !s.wildEncounter;
    const someoneJustJoined = s.players != null && s.players.length > playersLengthRef.current;
    if (inMyBattle && (incomingClearsBattle || someoneJustJoined)) {
      setPlayers(s.players ?? []);
      setCurrentPlayerIndex(s.currentPlayerIndex ?? 0);
      setEncounterLog(s.encounterLog ?? []);
      setPendingLearn(s.pendingLearn ?? null);
      setEvolutionNotice(s.evolutionNotice ?? null);
      setPvpRequest(s.pvpRequest ?? null);
      setPvpBattle(s.pvpBattle ?? null);
      setPvpTrade(s.pvpTrade ?? null);
      return;
    }
    setPhase(s.phase);
    setRoomCode(s.roomCode || "");
    setPlayers(s.players ?? []);
    setCurrentPlayerIndex(s.currentPlayerIndex ?? 0);
    setWildEncounter(s.wildEncounter ?? null);
    setEncounterLog(s.encounterLog ?? []);
    setPendingLearn(s.pendingLearn ?? null);
    setEvolutionNotice(s.evolutionNotice ?? null);
    setPvpRequest(s.pvpRequest ?? null);
    setPvpBattle(s.pvpBattle ?? null);
    setPvpTrade(s.pvpTrade ?? null);
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
    socket.on("roomCreated", onRoomCreated);
    socket.on("state", onState);
    socket.on("joinError", onJoinError);
    return () => {
      socket.off("roomCreated", onRoomCreated);
      socket.off("state", onState);
      socket.off("joinError", onJoinError);
    };
  }, [socket]);

  useEffect(() => {
    if (!socket || !roomCode || roomCode === "SOLO") return;
    if (skipEmitRef.current) {
      skipEmitRef.current = false;
      return;
    }
    if (skipEmitAfterPvpAcceptRef.current) {
      skipEmitAfterPvpAcceptRef.current = false;
      return;
    }
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
  }, [socket, roomCode, phase, players, currentPlayerIndex, wildEncounter, encounterLog, pendingLearn, evolutionNotice, pvpRequest, pvpBattle, pvpTrade]);

  const addPlayer = (name: string) => {
    setPlayers((p) => {
      if (p.length >= 4) return p;
      const next: Player = {
        id: `p${p.length + 1}`,
        name,
        color: ["red", "blue", "green", "yellow"][p.length],
        isReady: false,
        screen: "lobby",
        location: "Pallet Town",
        team: [],
        badges: []
      };
      return [...p, next];
    });
  };

  const toggleReady = (id: string) =>
    setPlayers((ps) => ps.map((pl) => (pl.id === id ? { ...pl, isReady: !pl.isReady } : pl)));

  const startGameIfReady = (forPlayerId?: string) => {
    if (players.length === 0) return;
    if (forPlayerId) {
      setPlayers((ps) => ps.map((pl) => (pl.id === forPlayerId ? { ...pl, screen: "starter" as PlayerScreen } : pl)));
      return;
    }
    const allReady = players.every((p) => p.isReady);
    const canStart = allReady || players.length === 1;
    if (canStart) setPhase("starter");
  };

  const startSingleplayer = (playerName: string) => {
    const name = (playerName || "Player 1").trim() || "Player 1";
    skipEmitRef.current = true;
    setRoomCode("SOLO");
    setPhase("lobby");
    setPlayers([{
      id: "solo",
      name,
      color: "red",
      isHost: true,
      isReady: true,
      screen: "lobby",
      location: "Pallet Town",
      team: [],
      badges: []
    }]);
    setCurrentPlayerIndex(0);
    setWildEncounter(null);
    setPvpRequest(null);
    setPvpBattle(null);
    setPvpTrade(null);
  };

  const selectStarter = (playerId: string, starterId: number) => {
    getPokemonTemplate(starterId).then((tpl) => {
      const inst = makeInstanceFromTemplate(tpl, 5);
      setPlayers((ps) =>
        ps.map((pl) =>
          pl.id === playerId
            ? { ...pl, team: [{ ...inst }], location: "Pallet Town", screen: "map" as PlayerScreen }
            : pl
        )
      );
    }).catch(() => {});
    setTimeout(() => {
      const all = players.every((p) => p.team.length > 0 || p.id === playerId);
      if (all) setPhase("map");
    }, 50);
  };

  const movePlayer = (playerId: string, to: string) => {
    setPlayers((ps) =>
      ps.map((pl) => (pl.id === playerId ? { ...pl, location: to } : pl))
    );
    const loc = LOCATIONS[to];
    if (loc?.type === "grass" && loc.wildPool?.length) {
      sound.playSfx("battle-start");
      const pid = loc.wildPool[Math.floor(Math.random() * loc.wildPool.length)];
      getPokemonTemplate(pid).then((tpl) => {
        const lvl = Math.max(3, Math.floor(Math.random() * 5) + 3);
        const inst = makeInstanceFromTemplate(tpl, lvl);
        const encounter = { pokemon: inst, location: to, triggeredByPlayerId: playerId };
        myBattleRef.current = { phase: "battle", wildEncounter: encounter };
        setWildEncounter(encounter);
        setTimeout(() => setPhase("battle"), 50);
      }).catch(() => {});
    }
  };

  const searchWild = (playerId: string) => {
    const pl = players.find((p) => p.id === playerId);
    if (!pl) return;
    const loc = LOCATIONS[pl.location];
    if (!loc || !loc.wildPool || loc.wildPool.length === 0) return;
    sound.playSfx("battle-start");
    const pid = loc.wildPool[Math.floor(Math.random() * loc.wildPool.length)];
    getPokemonTemplate(pid).then((tpl) => {
      const lvl = Math.max(3, Math.floor(Math.random() * 5) + 3);
      const inst = makeInstanceFromTemplate(tpl, lvl);
      const encounter = { pokemon: inst, location: pl.location, triggeredByPlayerId: playerId };
      myBattleRef.current = { phase: "battle", wildEncounter: encounter };
      setWildEncounter(encounter);
      setTimeout(() => setPhase("battle"), 50);
    }).catch(() => {});
  };

  const captureAttempt = (chance = 0.8, forPlayerId?: string) => {
    if (!wildEncounter) return false;
    const idx = forPlayerId != null ? players.findIndex((p) => p.id === forPlayerId) : currentPlayerIndex;
    if (idx < 0) return false;
    const ok = Math.random() < chance;
    if (ok) {
      sound.playSfx("capture");
      setPlayers((ps) =>
        ps.map((pl, i) => (i === idx ? { ...pl, team: [...pl.team, wildEncounter.pokemon] } : pl))
      );
      setWildEncounter(null);
    }
    return ok;
  };
 
  const grantXpToLead = async (playerIdx: number, xpGain: number) => {
    const pl = players[playerIdx];
    if (!pl) return;
    const mon = pl.team[0];
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
      // Full heal only when level increased; otherwise keep current HP
      const newHp = levelGained > 0 ? newInst.maxHp : Math.min(mon.hp ?? newInst.maxHp, newInst.maxHp);
      const updatedMon = { ...mon, level, xp: newXp, xpToNext, maxHp: newInst.maxHp, hp: newHp, stats: newInst.stats, moves };
      setPlayers((ps) =>
        ps.map((p, idx) => (idx === playerIdx ? { ...p, team: [updatedMon, ...p.team.slice(1)] } : p))
      );
      if (levelGained > 0) {
        let didEvolve = false;
        try {
          const evo = await getNextEvolution(mon.id);
          if (evo && (evo.minLevel === null || level >= evo.minLevel)) {
            const evoTpl = await getPokemonTemplate(evo.id);
            const evolved = makeInstanceFromTemplate(evoTpl, level);
            setPlayers((ps) =>
              ps.map((p, idx) => (idx === playerIdx ? { ...p, team: [evolved, ...p.team.slice(1)] } : p))
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
            setPendingLearn({ playerIndex: playerIdx, pokemonIndex: 0, newMove: toLearn[0], newLevel: level, remainingMoves: toLearn.slice(1) });
          }
        }
      }
    } catch {
      // Fallback when API fails: simple stat growth (+1 per stat, +2 maxHp per level gained)
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
            ? { ...p, team: [{ ...mon, level, xp: newXp, xpToNext, maxHp: newMaxHp, hp: newHp, stats: newStats }, ...p.team.slice(1)] }
            : p
        )
      );
    }
  };

  const attackWild = async (moveName?: string) => {
    if (!wildEncounter) return;
    const player = players[currentPlayerIndex];
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
    // grant small xp to lead
    const playerIdx = currentPlayerIndex;
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
    // wild retaliates if still alive
    setTimeout(() => {
      setWildEncounter((we) => {
        if (!we) return we;
        if (we.pokemon.hp <= 0) return we;
        const wildAtk = we.pokemon.stats?.attack ?? 5;
        const playerDef = players[currentPlayerIndex].team[0].stats?.defense ?? 5;
        const wildDmg = Math.max(1, Math.floor((wildAtk / playerDef) * 4 * (Math.random() * 0.4 + 0.8)));
        // apply damage to player's lead
        setPlayers((ps) =>
          ps.map((pl, idx) => {
            if (idx !== currentPlayerIndex) return pl;
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

  const addBadge = (playerId: string, badge: string) => {
    setPlayers((ps) =>
      ps.map((pl) => (pl.id === playerId && !pl.badges.includes(badge) ? { ...pl, badges: [...pl.badges, badge] } : pl))
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
    }
  };

  const requestPvpBattle = (fromPlayerId: string, toPlayerId: string) => {
    if (fromPlayerId === toPlayerId) return;
    const from = players.find((p) => p.id === fromPlayerId);
    const to = players.find((p) => p.id === toPlayerId);
    if (!from || !to || from.team.length === 0 || to.team.length === 0) return;
    setPvpRequest({ fromPlayerId, toPlayerId, type: "battle" });
  };

  const requestPvpTrade = (fromPlayerId: string, toPlayerId: string) => {
    if (fromPlayerId === toPlayerId) return;
    const from = players.find((p) => p.id === fromPlayerId);
    const to = players.find((p) => p.id === toPlayerId);
    if (!from || !to || from.team.length === 0 || to.team.length === 0) return;
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
    setPvpTrade(null);
  };

  const cancelTrade = () => {
    setPvpTrade(null);
  };

  const leaveRoom = () => {
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
    currentPlayerIndex,
    setCurrentPlayerIndex,
    movePlayer,
    wildEncounter,
    setWildEncounter,
    captureAttempt,
    updatePlayerLead,
    updateLeadPokemon,
    healPlayer,
    addBadge,
    searchWild,
    pendingLearn,
    finalizeLearn,
    grantXpToLead,
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

export default function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const game = useGameState(socket);
  const [starters, setStarters] = useState<any[] | null>(null);
  const [cityModal, setCityModal] = useState<null | { name: string; description?: string; gym?: string | null }>(null);
  const [gymBattle, setGymBattle] = useState<null | { leader: string; team: any[]; index: number }>(null);
  const [gymVictory, setGymVictory] = useState<string | null>(null);
  const [showTeam, setShowTeam] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showKantoMap, setShowKantoMap] = useState(false);
  const [muted, setMuted] = useState(() => sound.isMuted());
  const [achievementToast, setAchievementToast] = useState<null | (AchievementData & { id: string })>(null);

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

  const viewScreen: "home" | "lobby" | "starter" | "map" =
    effectivePhase === "home"
      ? "home"
      : effectivePhase === "battle" && !isMyBattle
        ? "map"
        : (isMultiplayer || isSolo)
          ? (currentPlayer?.screen ?? "lobby")
          : (effectivePhase === "encounter" || effectivePhase === "battle" ? "map" : effectivePhase);

  return (
    <div className="min-h-screen p-3 sm:p-4 pb-0">
      <header className="mb-3 sm:mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b-2 border-amber-500/30">
        <h1 className="text-sm sm:text-xl text-yellow-300 truncate font-bold">Pokémon Kanto</h1>
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
            onLeaveRoom={() => {
              if (socket && game.roomCode && game.roomCode !== "SOLO") socket.emit("leaveRoom");
              game.leaveRoom();
              setGymBattle(null);
              setGymVictory(null);
              setCityModal(null);
              setShowTeam(false);
            }}
          />
        )}

        {viewScreen === "starter" && starters && (
          <StarterSelectScreen
            players={game.players}
            selectStarter={game.selectStarter}
            starters={starters}
            myPlayerId={myPlayerIdForUi}
            onLeaveRoom={() => {
              if (socket && game.roomCode && game.roomCode !== "SOLO") socket.emit("leaveRoom");
              game.leaveRoom();
              setGymBattle(null);
              setGymVictory(null);
              setCityModal(null);
              setShowTeam(false);
            }}
          />
        )}

        {viewScreen === "map" && (
          <MapScreen
            players={game.players}
            currentPlayerIndex={effectivePlayerIndex}
            movePlayer={(playerId: string, to: string) => {
              game.movePlayer(playerId, to);
              const loc = LOCATIONS[to];
              if (loc?.type === "town") {
                setTimeout(() => setCityModal({ name: to, description: `${to} — a place of adventure.`, gym: loc.gym ?? null }), 150);
              }
            }}
            searchWild={game.searchWild}
            isMultiplayer={isMultiplayer}
            myPlayerId={isSolo ? currentPlayer?.id ?? null : (isMultiplayer ? currentPlayer?.id ?? null : (socket?.id ?? null))}
            requestPvpBattle={game.requestPvpBattle}
            requestPvpTrade={game.requestPvpTrade}
            pendingPvpRequest={game.pvpRequest}
          />
        )}
        <div id="bottom-nav-placeholder"></div>
        {cityModal && (
          <CityModal
            name={cityModal.name}
            description={cityModal.description}
            gym={cityModal.gym}
            onClose={() => setCityModal(null)}
            onHeal={() => game.healPlayer(currentPlayer?.id ?? "")}
            onChallenge={() => {
              // start gym battle: build leader team based on gym key
              const leaderKey = cityModal!.gym!;
              const leaders: Record<string, { name: string; team: { id: number; level: number }[] }> = {
                "Brock": { name: "Brock", team: [{ id: 74, level: 12 }, { id: 95, level: 14 }] }, // Geodude, Onix
                "Misty": { name: "Misty", team: [{ id: 60, level: 18 }, { id: 121, level: 21 }] }, // Poliwag, Starmie
                "Lt. Surge": { name: "Lt. Surge", team: [{ id: 25, level: 20 }, { id: 26, level: 22 }] }, // Pikachu, Raichu
                "Erika": { name: "Erika", team: [{ id: 43, level: 29 }, { id: 45, level: 32 }] }, // Oddish/Vileplume
                "Koga": { name: "Koga", team: [{ id: 109, level: 38 }, { id: 110, level: 40 }] }, // Koffing, Weezing
                "Sabrina": { name: "Sabrina", team: [{ id: 64, level: 48 }, { id: 65, level: 50 }] }, // Kadabra/Alakazam
                "Blaine": { name: "Blaine", team: [{ id: 58, level: 52 }, { id: 59, level: 54 }] }, // Growlithe/Arcanine
                "Giovanni": { name: "Giovanni", team: [{ id: 111, level: 56 }, { id: 112, level: 60 }] } // Rhydon etc.
              };
              const leader = leaders[leaderKey || ""] || leaders["Brock"];
              // instantiate leader team
              Promise.all(leader.team.map((m) => getPokemonTemplate(m.id).then((tpl) => makeInstanceFromTemplate(tpl, m.level)))).then((instances) => {
                setGymBattle({ leader: leader.name, team: instances, index: 0 });
                setCityModal(null);
              });
            }}
          />
        )}

        {gymVictory && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
            <div className="bg-gray-900 p-4 rounded-lg text-white max-w-sm text-center shadow-xl">
              <div className="font-bold text-yellow-300 mb-2 text-sm sm:text-base">Gym victory!</div>
              <p className="text-xs sm:text-sm mb-4">You defeated {gymVictory} and earned the badge.</p>
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
            onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
            onEnd={(res) => {
              sound.stopSfx("battle-start");
              game.setPhase("map");
              game.setWildEncounter(null);
              if (res.winner === "player" && currentPlayer) {
                const lead = currentPlayer.team[0];
                const grant = game.grantXpToLead;
                const xpToNext = lead?.xpToNext ?? 40;
                const currentXp = lead?.xp ?? 0;
                const xpNeeded = Math.max(1, xpToNext - currentXp);
                setTimeout(() => grant(effectivePlayerIndex, xpNeeded), 0);
              }
            }}
            onPlayerUpdate={(p) => {
              if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p);
            }}
            onCapture={(ultra) => {
              if (!game.wildEncounter || !currentPlayer) return false;
              if (ultra) return game.captureAttempt(1, currentPlayer.id);
              const we = game.wildEncounter.pokemon;
              const hpFactor = 1 - (we.hp / we.maxHp);
              const chance = Math.min(0.95, 0.5 + hpFactor * 0.6);
              const ok = Math.random() < chance;
              if (ok) {
                const captured = game.captureAttempt(1, currentPlayer.id);
                if (captured) game.grantXpToLead(effectivePlayerIndex, Math.max(1, (we.level ?? 1) * 5));
                return captured;
              }
              return false;
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
            onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer!.id, i)}
            onPlayerUpdate={(p) => { if (currentPlayer) game.updateLeadPokemon(currentPlayer.id, p); }}
            onEnd={(res) => {
              sound.stopSfx("battle-start");
              if (res.winner === "player") {
                if (res.xpGain != null) {
                  setTimeout(() => game.grantXpToLead(effectivePlayerIndex, res.xpGain!), 0);
                }
                if (gymBattle.index + 1 < gymBattle.team.length) {
                  setGymBattle((prev) => prev ? { ...prev, index: prev.index + 1 } : null);
                } else {
                  game.addBadge(currentPlayer!.id, gymBattle.leader);
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
              }
            }}
          />
        )}
        {game.phase === "battle" && game.pvpBattle && isMyPvPBattle && currentPlayer && (() => {
          const pvp = game.pvpBattle!;
          const { challengerId, defenderId } = pvp;
          const challenger = game.players.find((p) => p.id === challengerId);
          const defender = game.players.find((p) => p.id === defenderId);
          const myLead = currentPlayer.team[0];
          const theirLead = (socket?.id === challengerId ? defender : challenger)?.team[0];
          if (!myLead || !theirLead) return null;
          const amChallenger = socket?.id === challengerId;
          const myHp = amChallenger ? (pvp.challengerHp ?? myLead.hp) : (pvp.defenderHp ?? myLead.hp);
          const theirHp = amChallenger ? (pvp.defenderHp ?? theirLead.hp) : (pvp.challengerHp ?? theirLead.hp);
          const myMaxHp = amChallenger ? (pvp.challengerMaxHp ?? myLead.maxHp) : (pvp.defenderMaxHp ?? myLead.maxHp);
          const theirMaxHp = amChallenger ? (pvp.defenderMaxHp ?? theirLead.maxHp) : (pvp.challengerMaxHp ?? theirLead.maxHp);
          return (
            <BattleModal
              isPvP
              playerPokemon={{ ...myLead, hp: myHp, maxHp: myMaxHp }}
              enemyPokemon={{ ...theirLead, hp: theirHp, maxHp: theirMaxHp }}
              playerTeam={currentPlayer.team}
              pvpBattleState={pvp.status ? { log: pvp.log ?? [], status: pvp.status, winner: pvp.winner, myMoveSubmitted: amChallenger ? pvp.challengerMove != null : pvp.defenderMove != null } : undefined}
              pvpYouWon={pvp.winner != null && (pvp.winner === "challenger") === amChallenger}
              onPvpSubmitMove={(moveName) => socket?.emit("pvpSubmitMove", moveName)}
              onSwitchPokemon={(i) => game.updatePlayerLead(currentPlayer.id, i)}
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
          const myTeam = game.players.find((p) => p.id === meId)?.team ?? [];
          const canConfirm = trade!.aSelectedIndex != null && trade!.bSelectedIndex != null;
          return (
            <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/60 p-4">
              <div className="bg-gray-900 rounded-lg p-4 max-w-sm w-full text-white shadow-xl max-h-[90vh] overflow-y-auto">
                <h3 className="text-base font-bold text-yellow-300 mb-3">Trade Pokémon</h3>
                <p className="text-xs text-gray-400 mb-2">Choose one Pokémon to offer:</p>
                <div className="space-y-2 mb-4">
                  {myTeam.map((pk, i) => (
                    <button
                      key={i}
                      className={`w-full flex items-center gap-2 p-2 rounded bg-gray-700 text-left ${mySelection === i ? "ring-2 ring-yellow-400" : ""}`}
                      onClick={() => game.setTradeSelection(meId, mySelection === i ? null : i)}
                    >
                      <img src={pk.sprite} className="w-10 h-10" alt={pk.name} />
                      <span className="text-sm">{pk.name} Lv{pk.level}</span>
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <button className="pixel-btn flex-1" onClick={() => game.cancelTrade()}>Cancel</button>
                  <button className="pixel-btn flex-1" disabled={!canConfirm} onClick={() => game.executeTrade()}>
                    {canConfirm ? "Confirm trade" : "Waiting for other..."}
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
        {showMenu && (
          <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-4" onClick={() => setShowMenu(false)}>
            <div className="card-panel p-4 w-full max-w-xs border-2 border-amber-500/40" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-bold text-sm text-amber-300">☰ Menu</span>
                <button type="button" className="pixel-btn text-xs" onClick={() => setShowMenu(false)}>Close</button>
              </div>
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
                    onClick={() => {
                      if (socket && game.roomCode && game.roomCode !== "SOLO") socket.emit("leaveRoom");
                      game.leaveRoom();
                      setShowMenu(false);
                      setGymBattle(null);
                      setGymVictory(null);
                      setCityModal(null);
                      setShowTeam(false);
                    }}
                  >
                    Leave room
                  </button>
                </div>
              )}
              <p className="text-[10px] text-gray-500 mt-3">Put your .mp3 in <code className="bg-gray-800 px-1 rounded">public/sounds/</code>: battle-start, capture, level-up, evolution, achievement, gym-victory</p>
            </div>
          </div>
        )}
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
          onClose={() => setShowKantoMap(false)}
        />
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
    <div className="max-w-md mx-auto space-y-6">
      <h2 className="text-sm sm:text-lg text-yellow-300 mb-4">Create or join a room</h2>

      {isLocalhost && startSingleplayer && (
        <div className="p-4 card-panel border-2 border-amber-500/50">
          <div className="font-bold text-xs sm:text-sm mb-2 text-amber-300">Singleplayer (localhost)</div>
          <p className="text-[10px] sm:text-xs text-gray-400 mb-3">Play alone to test the game. No room code needed.</p>
          <input
            className="input-pixel w-full mb-3 text-sm"
            placeholder="Your name"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
          />
          <button className="pixel-btn pixel-btn-primary w-full" onClick={handlePlayAlone}>
            Play alone
          </button>
        </div>
      )}

      <div className="p-4 card-panel">
        <div className="font-bold text-xs sm:text-sm mb-2 text-amber-300">Create room</div>
        <input
          className="input-pixel w-full mb-3 text-sm"
          placeholder="Your name"
          value={createName}
          onChange={(e) => setCreateName(e.target.value)}
        />
        <button className="pixel-btn w-full" onClick={handleCreate} disabled={!socket}>
          Create room
        </button>
        <p className="text-[10px] text-gray-400 mt-2">You’ll get a code to share with others.</p>
      </div>

      <div className="p-4 card-panel">
        <div className="font-bold text-xs sm:text-sm mb-2 text-amber-300">Join room</div>
        <input
          className="input-pixel w-full mb-2 text-sm"
          placeholder="Room code"
          value={joinCode}
          onChange={(e) => { setJoinCode(e.target.value.toUpperCase()); setJoinError(null); }}
        />
        <input
          className="input-pixel w-full mb-3 text-sm"
          placeholder="Your name"
          value={joinName}
          onChange={(e) => setJoinName(e.target.value)}
        />
        <button className="pixel-btn w-full" onClick={handleJoin} disabled={!socket}>
          Join room
        </button>
        {joinError && <p className="text-red-400 text-xs mt-2">{joinError}</p>}
      </div>
    </div>
  );
}

function LobbyScreen({ players, addPlayer, toggleReady, startGame, roomCode, myPlayerId, independentStart, onLeaveRoom }: { players: Player[]; addPlayer: (name: string) => void; toggleReady: (id: string) => void; startGame: () => void; roomCode?: string; myPlayerId?: string; independentStart?: boolean; onLeaveRoom?: () => void }) {
  const [name, setName] = useState("");
  const canStart = independentStart ? players.length > 0 : (players.length > 0 && (players.every((p) => p.isReady) || players.length === 1));
  return (
    <div>
      <div className="mb-3 text-xs sm:text-sm flex flex-wrap items-start justify-between gap-2">
        <div>
          Lobby
        {roomCode && (
          <span className="block mt-1 text-yellow-300">
            {roomCode === "SOLO" ? "Singleplayer" : <>Share code: <strong>{roomCode}</strong></>}
          </span>
        )}
        {independentStart && roomCode && roomCode !== "SOLO" && (
          <p className="text-[10px] text-gray-400 mt-1">Start when you want — you don’t need others to be ready.</p>
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
          <div key={p.id} className="card-panel p-3 rounded-lg">
            <div className="text-xs sm:text-sm truncate">{p.name} <span className="text-[10px] sm:text-xs text-gray-300">({p.color})</span></div>
            <div className="mt-2">
              {myPlayerId == null ? (
                <button className="pixel-btn w-full sm:w-auto" onClick={() => toggleReady(p.id)}>{p.isReady ? "UNREADY" : "READY"}</button>
              ) : p.id === myPlayerId ? (
                <button className="pixel-btn w-full sm:w-auto" onClick={() => toggleReady(p.id)}>{p.isReady ? "UNREADY" : "READY"}</button>
              ) : (
                <span className="text-xs text-gray-400">{p.isReady ? "Ready" : "Not ready"}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4">
        {!independentStart && players.length > 0 && (
          <p className="text-xs text-gray-400 mb-2">
            {players.every((p) => p.isReady)
              ? "Everyone is ready!"
              : `${players.filter((p) => p.isReady).length}/${players.length} ready`}
          </p>
        )}
        <button
          className="pixel-btn w-full disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={startGame}
          disabled={!canStart}
        >
          Start Game
        </button>
      </div>
    </div>
  );
}

function StarterSelectScreen({ players, selectStarter, starters, myPlayerId, onLeaveRoom }: { players: Player[]; selectStarter: (playerId: string, starterId: number) => void; starters: any[]; myPlayerId?: string; onLeaveRoom?: () => void }) {
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="text-sm sm:text-lg text-yellow-300">Choose your starter</h2>
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

function MapScreen({
  players,
  currentPlayerIndex,
  movePlayer,
  searchWild,
  isMultiplayer,
  myPlayerId,
  requestPvpBattle,
  requestPvpTrade,
  pendingPvpRequest
}: {
  players: Player[];
  currentPlayerIndex: number;
  movePlayer: (playerId: string, to: string) => void;
  searchWild: (playerId: string) => void;
  isMultiplayer?: boolean;
  myPlayerId?: string | null;
  requestPvpBattle?: (from: string, to: string) => void;
  requestPvpTrade?: (from: string, to: string) => void;
  pendingPvpRequest?: PvpRequest | null;
}) {
  const current = players[currentPlayerIndex];
  const loc = LOCATIONS[current.location];
  const typeInfo = loc ? LOCATION_TYPE_LABELS[loc.type] ?? { icon: "?", label: loc.type, bg: "bg-gray-700/50" } : { icon: "?", label: "?", bg: "bg-gray-700/50" };
  const gymLeader = loc?.gym ? GYM_LEADER_SPRITES[loc.gym] : null;
  const connections = loc?.connections ?? [];
  const playersHere = isMultiplayer && myPlayerId
    ? players.filter((p) => p.id !== myPlayerId && p.location === current.location)
    : [];

  return (
    <div className="md:flex gap-4">
      <div className="md:w-2/3 space-y-4 min-w-0">
        {/* You are here — current location card */}
        <div className={`card-panel p-3 sm:p-4 border-2 border-amber-500/50 ${typeInfo.bg}`}>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-yellow-300">You are here</span>
            <span className="text-lg sm:text-xl" title={typeInfo.label}>{typeInfo.icon}</span>
          </div>
          <div className="flex flex-wrap items-start gap-3 sm:gap-4">
            <div className="min-w-0">
              <h2 className="text-base sm:text-xl font-bold text-white truncate">{current.location}</h2>
              <p className="text-xs sm:text-sm text-gray-300">{typeInfo.label}</p>
            </div>
            {loc?.gym && (
              <div className="flex items-center gap-2 bg-gray-800/80 rounded-lg px-2 py-1.5 border border-amber-600/50">
                <img
                  src={gymLeader ?? ""}
                  alt={loc.gym}
                  className="w-12 h-12 sm:w-14 sm:h-14 object-contain bg-gray-900 rounded"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div>
                  <span className="text-[10px] sm:text-xs text-amber-300 block">Gym Leader</span>
                  <span className="text-sm sm:text-base font-bold text-white">{loc.gym}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Paths from here — map structure */}
        <div className="card-panel p-3 sm:p-4 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-sm sm:text-base font-bold text-yellow-300">Paths from here</span>
            <span className="text-xs text-gray-400">({connections.length} connection{connections.length !== 1 ? "s" : ""})</span>
          </div>
          <div className="space-y-2">
            {connections.map((c) => {
              const connLoc = LOCATIONS[c];
              const connType = connLoc ? (LOCATION_TYPE_LABELS[connLoc.type] ?? { icon: "•", label: connLoc.type }) : { icon: "•", label: "" };
              const wildInfo = connLoc?.wildPool?.length ? ` · ${connLoc.wildPool.length} wilds` : "";
              return (
                <div key={c} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-gray-700/80 hover:bg-gray-700 p-2.5 rounded-lg border border-gray-600/50">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="text-base flex-shrink-0" title={connType.label}>{connType.icon}</span>
                    <div className="min-w-0">
                      <div className="font-bold text-xs sm:text-base truncate text-white">{c}</div>
                      <div className="text-[10px] sm:text-xs text-gray-400 truncate">{connType.label}{wildInfo}</div>
                    </div>
                    <span className="text-gray-500 flex-shrink-0 sm:ml-1">→</span>
                  </div>
                  <button className="pixel-btn w-full sm:w-auto flex-shrink-0 text-xs sm:text-sm" onClick={() => movePlayer(current.id, c)}>Go</button>
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-gray-600/50 flex flex-col sm:flex-row gap-2">
            <button className="pixel-btn flex-1 text-xs sm:text-sm bg-gray-600/80" onClick={() => {}}>Stay here</button>
            {loc?.type === "grass" && (
              <button className="pixel-btn pixel-btn-primary flex-1 text-xs sm:text-sm" onClick={() => searchWild(current.id)}>🌿 Search for wild</button>
            )}
          </div>
        </div>

        {playersHere.length > 0 && (
          <div className="p-3 bg-gray-800 rounded-lg border border-gray-600/50">
            <div className="text-xs sm:text-sm font-bold text-yellow-300 mb-2">Players here</div>
            <div className="flex flex-col gap-2">
              {playersHere.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs sm:text-sm truncate">{p.name}</span>
                  <div className="flex gap-2">
                    <button className="pixel-btn text-[10px] sm:text-xs" onClick={() => requestPvpBattle?.(myPlayerId!, p.id)}>Battle</button>
                    <button className="pixel-btn text-[10px] sm:text-xs" onClick={() => requestPvpTrade?.(myPlayerId!, p.id)}>Trade</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <aside className="md:w-1/3 p-3 card-panel mt-3 md:mt-0 min-w-0 border border-gray-700/50">
        <div className="text-xs sm:text-sm text-gray-400 mb-1">Playing as</div>
        <div className="text-sm sm:text-base font-bold text-yellow-300 truncate mb-2">{current.name}</div>
        <div className="text-[10px] sm:text-xs text-gray-500 mb-3 truncate" title={current.location}>📍 {current.location}</div>
        <div className="text-xs sm:text-sm font-bold text-gray-300 mb-2">Team</div>
        <div className="space-y-2">
          {current.team.map((pk, idx) => {
            const maxHp = pk.maxHp ?? 1;
            const curHp = pk.hp ?? 0;
            const pct = Math.max(0, (curHp / maxHp) * 100);
            const hpCol = pct > 60 ? "bg-green-500" : pct > 30 ? "bg-yellow-500" : "bg-red-500";
            return (
              <div key={`${pk.id}-${idx}`} className={`flex items-center gap-2 bg-gray-700/80 p-2 rounded-lg min-w-0 border ${idx === 0 ? "border-amber-500/50" : "border-transparent"}`}>
                <img src={pk.sprite} className="w-10 h-10 sm:w-12 sm:h-12 flex-shrink-0 rounded-lg bg-gray-800" alt={pk.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs sm:text-sm truncate">{idx === 0 && "★ "}{pk.name} Lv{pk.level}</div>
                  <div className="h-1.5 hp-bar bg-gray-800 rounded w-full mt-1 max-w-[100px]">
                    <div className={`hp-bar-fill h-1.5 ${hpCol} rounded`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-400">{pk.hp}/{pk.maxHp}</div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>
    </div>
  );
}

function WildEncounterModal({ pokemon, onCapture, onFlee, onAttack }: { pokemon: Pokemon; onCapture: () => void; onFlee: () => void; onAttack: (move?: string) => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/60">
      <div className="bg-gray-900 p-6 rounded-md text-center w-11/12 max-w-md">
        <div className="text-lg mb-2">A wild {pokemon.name} appeared!</div>
        <img src={pokemon.sprite} alt={pokemon.name} className="mx-auto w-32 h-32" />
        <div className="mt-2">HP: {pokemon.hp}/{pokemon.maxHp}</div>
        <div className="mt-4 flex gap-2 flex-wrap justify-center">
          <button className="pixel-btn" onClick={onCapture}>CAPTURE</button>
          <button className="pixel-btn" onClick={onFlee}>FLEE</button>
          <button className="pixel-btn" onClick={() => onAttack(undefined)}>ATTACK</button>
        </div>
        {pokemon.moves && pokemon.moves.length > 0 && (
          <div className="mt-3">
            <div className="text-sm mb-1">Moves:</div>
            <div className="flex gap-2 justify-center flex-wrap">
              {pokemon.moves.map((m) => (
                <button key={m} className="pixel-btn text-xs" onClick={() => onAttack(m)}>{m}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
