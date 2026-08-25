import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { resolvePvpTurn, applyForcedSwitch } from "./battle.js";
import { canInteract, canonicalMapId, DEFAULT_SPAWN, findOpenTile, getWarp, isLegalMove, isLegalWarp } from "./maps/pallet.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const ROOM_EXPIRE_MS = 5 * 60 * 1000; // 5 min after last player leaves
const PERSIST_PATH = path.join(__dirname, "rooms.json");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" }
});

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Hex colors so Phaser/Canvas can render remotes without a name→hex map. */
const COLORS = [
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
const MAX_PLAYERS = 10;
const VALID_FACINGS = new Set(["up", "down", "left", "right"]);
const rooms = new Map();
const roomExpireTimers = new Map();

function migratePlayerWorld(player) {
  const next = { ...player };
  const mapId = String(next.tilePos?.mapId || "");
  if (!mapId.startsWith("pallet_") || mapId === "pallet_rival_house_2f") {
    next.tilePos = { ...DEFAULT_SPAWN };
  } else {
    next.tilePos = { ...next.tilePos, mapId: canonicalMapId(mapId) };
  }
  if (!next.location) next.location = "Pallet Town";
  if (!next.lastTown) next.lastTown = "Pallet Town";
  if (!next.spriteId || next.spriteId === "personagem") next.spriteId = "red";
  return next;
}

function createInitialState(roomCode, firstPlayer) {
  return {
    phase: "lobby",
    roomCode,
    players: [firstPlayer],
    currentPlayerIndex: 0,
    wildEncounter: null,
    encounterLog: [],
    pendingLearn: null,
    evolutionNotice: null
  };
}

function scheduleRoomExpire(roomCode) {
  const existing = roomExpireTimers.get(roomCode);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    roomExpireTimers.delete(roomCode);
    rooms.delete(roomCode);
    persistRooms(); // update file to remove expired room
  }, ROOM_EXPIRE_MS);
  roomExpireTimers.set(roomCode, t);
}

function cancelRoomExpire(roomCode) {
  const t = roomExpireTimers.get(roomCode);
  if (t) {
    clearTimeout(t);
    roomExpireTimers.delete(roomCode);
  }
}

function persistRooms() {
  try {
    const toSave = {};
    for (const [code, state] of rooms) {
      if (!state.players?.length) continue;
      toSave[code] = { ...state, players: state.players.map((p) => ({ ...p, id: null })) };
    }
    fs.writeFileSync(PERSIST_PATH, JSON.stringify(toSave, null, 2), "utf8");
  } catch (e) {
    console.error("persistRooms:", e);
  }
}

function loadRooms() {
  try {
    if (!fs.existsSync(PERSIST_PATH)) return;
    const raw = fs.readFileSync(PERSIST_PATH, "utf8");
    const data = JSON.parse(raw);
    for (const [code, state] of Object.entries(data)) {
      if (state.players?.length) {
        rooms.set(code, { ...state, players: state.players.map((p) => ({ ...migratePlayerWorld(p), id: null })) });
        scheduleRoomExpire(code);
      }
    }
  } catch (e) {
    console.error("loadRooms:", e);
  }
}

loadRooms();
setInterval(persistRooms, 30_000);

io.on("connection", (socket) => {
  socket.on("createRoom", (playerName) => {
    const name = (playerName || "Player 1").trim() || "Player 1";
    let code = generateRoomCode();
    while (rooms.has(code)) code = generateRoomCode();

    const firstPlayer = {
      id: socket.id,
      name,
      color: COLORS[0],
      isHost: true,
      isReady: false,
      screen: "lobby",
      location: "Pallet Town",
      tilePos: findOpenTile(DEFAULT_SPAWN.mapId, DEFAULT_SPAWN, []),
      spriteId: "red",
      facing: "down",
      moving: false,
      lastTown: "Pallet Town",
      team: [],
      badges: [],
      bag: { pokeball: 10, greatball: 0, ultraball: 0, potion: 3, superpotion: 0, repel: 0, coins: 10 },
      wildEncounter: null,
      encounterLog: [],
      pendingLearn: null,
      evolutionNotice: null
    };

    const state = createInitialState(code, firstPlayer);
    rooms.set(code, state);
    socket.join(code);
    socket.roomCode = code;

    socket.emit("roomCreated", { roomCode: code, state });
  });

  socket.on("joinRoom", ({ code, playerName }) => {
    const roomCode = (code || "").trim().toUpperCase();
    if (!roomCode) {
      socket.emit("joinError", { message: "Enter a room code" });
      return;
    }
    const state = rooms.get(roomCode);
    if (!state) {
      socket.emit("joinError", { message: "Room not found" });
      return;
    }
    const name = (playerName || "").trim() || `Trainer ${state.players.length + 1}`;
    const existingByName = state.players.find((p) => p.name.toLowerCase() === name.toLowerCase());

    if (existingByName) {
      if (existingByName.id) {
        socket.emit("joinError", { message: "That name is already in the room. Pick another." });
        return;
      }
      existingByName.id = socket.id;
      cancelRoomExpire(roomCode);
      socket.join(roomCode);
      socket.roomCode = roomCode;
      io.to(roomCode).emit("state", state);
      return;
    }
    if (state.players.length >= MAX_PLAYERS) {
      socket.emit("joinError", { message: "Room is full" });
      return;
    }

    const occupied = state.players.filter((p) => p.tilePos).map((p) => p.tilePos);
    const newPlayer = {
      id: socket.id,
      name,
      color: COLORS[state.players.length % COLORS.length],
      isHost: false,
      isReady: false,
      screen: "lobby",
      location: "Pallet Town",
      tilePos: findOpenTile(DEFAULT_SPAWN.mapId, DEFAULT_SPAWN, occupied),
      spriteId: state.players.length % 2 === 1 ? "leaf" : "red",
      facing: "down",
      moving: false,
      lastTown: "Pallet Town",
      team: [],
      badges: [],
      bag: { pokeball: 10, greatball: 0, ultraball: 0, potion: 3, superpotion: 0, repel: 0, coins: 10 },
      wildEncounter: null,
      encounterLog: [],
      pendingLearn: null,
      evolutionNotice: null
    };
    state.players.push(newPlayer);
    cancelRoomExpire(roomCode);
    socket.join(roomCode);
    socket.roomCode = roomCode;

    io.to(roomCode).emit("state", state);
  });

  socket.on("stateUpdate", (state) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    if (state.roomCode !== roomCode) return;
    const current = rooms.get(roomCode);
    // Don't let a stale stateUpdate overwrite an active PvP battle (e.g. right after pvpAccept)
    if (current?.pvpBattle && current.pvpBattle.status !== "ended") {
      if (!state.pvpBattle || state.phase !== "battle") return;
    }
    // Merge per-player state: only sender can update their own full data; for others preserve identity (name, color, team, badges, location) from server to avoid one client overwriting another.
    const incoming = (state.players || []).map((p) => {
      const existing = p.id != null
        ? current.players.find((x) => x.id === p.id)
        : current.players.find((x) => (x.name || "").toLowerCase() === (p.name || "").toLowerCase());
      const isSender = p.id === socket.id;
      if (isSender) {
        return {
          ...p,
          // Keep authoritative movement from playerMove; snapshot can lag behind walking.
          tilePos: existing?.tilePos ?? p.tilePos,
          facing: existing?.facing ?? p.facing,
          moving: existing?.moving ?? p.moving,
          moveSeq: existing?.moveSeq ?? p.moveSeq,
          wildEncounter: state.wildEncounter ?? null,
          encounterLog: state.encounterLog ?? [],
          pendingLearn: state.pendingLearn ?? null,
          evolutionNotice: state.evolutionNotice ?? null
        };
      }
      // Movement is owned by playerMove — never let a snapshot rewind tilePos/facing/moving.
      // For other players: keep identity from server so a stale sender can't overwrite them.
      return {
        ...existing,
        ...p,
        id: p.id,
        name: existing?.name ?? p.name,
        color: existing?.color ?? p.color,
        team: existing?.team ?? p.team,
        badges: existing?.badges ?? p.badges,
        location: existing?.location ?? p.location,
        tilePos: existing?.tilePos ?? p.tilePos,
        spriteId: existing?.spriteId ?? p.spriteId,
        facing: existing?.facing ?? p.facing,
        moving: existing?.moving ?? p.moving,
        moveSeq: existing?.moveSeq ?? p.moveSeq,
        lastTown: p.lastTown ?? existing?.lastTown,
        screen: existing?.screen ?? p.screen,
        bag: p.bag ?? existing?.bag,
        wildEncounter: existing?.wildEncounter ?? null,
        encounterLog: existing?.encounterLog ?? [],
        pendingLearn: existing?.pendingLearn ?? null,
        evolutionNotice: existing?.evolutionNotice ?? null
      };
    });
    const seen = new Set(incoming.map((p) => p.id).filter(Boolean));
    for (const existing of current.players) {
      if (existing.id && !seen.has(existing.id)) incoming.push(existing);
    }
    const merged = { ...state, players: incoming };
    merged.wildEncounter = undefined;
    merged.encounterLog = undefined;
    merged.pendingLearn = undefined;
    merged.evolutionNotice = undefined;
    const toEmit = { ...merged, _fromSocketId: socket.id };
    rooms.set(roomCode, merged);
    io.to(roomCode).emit("state", toEmit);
  });

  socket.on("playerMove", (payload) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    const player = state.players.find((p) => p.id === socket.id);
    if (!player) return;
    const mapId = payload?.mapId;
    const x = payload?.x;
    const y = payload?.y;
    if (typeof mapId !== "string" || !mapId.trim()) return;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return;
    let nextPos = { mapId: canonicalMapId(mapId.trim()), x: Math.round(x), y: Math.round(y) };
    const from = player.tilePos || DEFAULT_SPAWN;
    const occupied = state.players
      .filter((p) => p.id && p.id !== player.id && p.tilePos)
      .map((p) => p.tilePos);
    const via = payload?.viaTile;
    let legal = false;
    if (via && typeof via.mapId === "string" && typeof via.x === "number" && typeof via.y === "number") {
      legal = isLegalWarp(from, via, nextPos, occupied);
    } else {
      const warp = getWarp(from.mapId, from.x, from.y);
      if (warp && warp.toMapId === nextPos.mapId) {
        nextPos = findOpenTile(warp.toMapId, { x: warp.toX, y: warp.toY }, occupied);
      }
      legal = isLegalMove(from, nextPos, occupied);
    }
    if (!legal) {
      player.moveSeq = (player.moveSeq || 0) + 1;
      socket.emit("moveRejected", {
        playerId: player.id,
        tilePos: player.tilePos || DEFAULT_SPAWN,
        facing: player.facing || "down",
        moving: false,
        seq: player.moveSeq,
      });
      return;
    }
    const facing = VALID_FACINGS.has(payload?.facing) ? payload.facing : (player.facing || "down");
    player.tilePos = nextPos;
    player.facing = facing;
    player.moving = Boolean(payload?.moving);
    player.location = "Pallet Town";
    player.moveSeq = (player.moveSeq || 0) + 1;
    io.to(roomCode).emit("playerMoved", {
      playerId: player.id,
      tilePos: player.tilePos,
      facing: player.facing,
      moving: player.moving,
      seq: player.moveSeq
    });
  });

  socket.on("achievement", (data) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    io.to(roomCode).emit("achievement", { ...data, ts: Date.now() });
  });

  socket.on("pvpAccept", ({ fromPlayerId, toPlayerId }) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    state.pvpRequest = null;
    const challenger = state.players.find((p) => p.id === fromPlayerId);
    const defender = state.players.find((p) => p.id === toPlayerId);
    if (!challenger?.team?.length || !defender?.team?.length) return;
    if (!canInteract(challenger.tilePos, challenger.facing, defender.tilePos) && !canInteract(defender.tilePos, defender.facing, challenger.tilePos)) {
      socket.emit("interactRejected", { message: "Trainers must stand face-to-face." });
      return;
    }
    const cIdx = challenger.team.findIndex((m) => (m.hp ?? 0) > 0);
    const dIdx = defender.team.findIndex((m) => (m.hp ?? 0) > 0);
    if (cIdx < 0 || dIdx < 0) return;
    const cLead = challenger.team[cIdx];
    const dLead = defender.team[dIdx];
    state.pvpBattle = {
      challengerId: fromPlayerId,
      defenderId: toPlayerId,
      challengerIndex: cIdx,
      defenderIndex: dIdx,
      challengerHp: cLead.hp ?? cLead.maxHp ?? 20,
      defenderHp: dLead.hp ?? dLead.maxHp ?? 20,
      challengerMaxHp: cLead.maxHp ?? 20,
      defenderMaxHp: dLead.maxHp ?? 20,
      log: [],
      status: "waiting_moves",
      challengerMove: null,
      defenderMove: null
    };
    state.phase = "battle";
    io.to(roomCode).emit("state", state);
  });

  socket.on("pvpSubmitMove", (payload) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    const pvp = state.pvpBattle;
    if (!pvp) return;
    const sid = socket.id;
    const action = typeof payload === "string" ? { kind: "move", moveName: payload.trim() } : payload;
    if (pvp.status === "waiting_switch") {
      const idx = action?.kind === "switch" ? action.index : null;
      if (typeof idx === "number") applyForcedSwitch(state, sid, idx);
      io.to(roomCode).emit("state", state);
      return;
    }
    if (pvp.status !== "waiting_moves" || !action) return;
    if (sid === pvp.challengerId) pvp.challengerMove = action;
    else if (sid === pvp.defenderId) pvp.defenderMove = action;
    else return;
    if (pvp.challengerMove != null && pvp.defenderMove != null) {
      resolvePvpTurn(state);
    }
    io.to(roomCode).emit("state", state);
  });

  socket.on("pvpEnd", ({ challengerHp, defenderHp }) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    const pvp = state.pvpBattle;
    if (!pvp) return;
    for (const p of state.players) {
      if (p.id === pvp.challengerId && p.team?.[pvp.challengerIndex ?? 0]) {
        p.team[pvp.challengerIndex ?? 0].hp = Math.max(0, challengerHp);
      }
      if (p.id === pvp.defenderId && p.team?.[pvp.defenderIndex ?? 0]) {
        p.team[pvp.defenderIndex ?? 0].hp = Math.max(0, defenderHp);
      }
    }
    state.pvpBattle = null;
    state.phase = "map";
    io.to(roomCode).emit("state", state);
  });

  socket.on("tradeConfirm", ({ playerAId, playerBId, aSelectedIndex, bSelectedIndex }) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    const trade = state.pvpTrade;
    if (!trade || trade.playerAId !== playerAId || trade.playerBId !== playerBId) return;
    if (socket.id !== playerAId && socket.id !== playerBId) return;
    if (aSelectedIndex == null || bSelectedIndex == null || aSelectedIndex < 0 || bSelectedIndex < 0) return;
    const playerA = state.players.find((p) => p.id === playerAId);
    const playerB = state.players.find((p) => p.id === playerBId);
    if (!playerA?.team?.[aSelectedIndex] || !playerB?.team?.[bSelectedIndex]) return;
    if (!canInteract(playerA.tilePos, playerA.facing, playerB.tilePos) && !canInteract(playerB.tilePos, playerB.facing, playerA.tilePos)) {
      return;
    }
    const monA = playerA.team[aSelectedIndex];
    const monB = playerB.team[bSelectedIndex];
    const aTeam = [...playerA.team];
    const bTeam = [...playerB.team];
    aTeam[aSelectedIndex] = monB;
    bTeam[bSelectedIndex] = monA;
    for (const p of state.players) {
      if (p.id === playerAId) {
        p.team = aTeam;
        break;
      }
    }
    for (const p of state.players) {
      if (p.id === playerBId) {
        p.team = bTeam;
        break;
      }
    }
    state.pvpTrade = null;
    io.to(roomCode).emit("state", state);
  });

  function clearPvpForPlayer(state, playerId) {
    if (state.pvpRequest && (state.pvpRequest.fromPlayerId === playerId || state.pvpRequest.toPlayerId === playerId)) {
      state.pvpRequest = null;
    }
    if (state.pvpBattle && (state.pvpBattle.challengerId === playerId || state.pvpBattle.defenderId === playerId)) {
      state.pvpBattle = null;
      state.phase = "map";
    }
    if (state.pvpTrade && (state.pvpTrade.playerAId === playerId || state.pvpTrade.playerBId === playerId)) {
      state.pvpTrade = null;
    }
  }

  socket.on("leaveRoom", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    socket.leave(roomCode);
    socket.roomCode = null;
    if (rooms.has(roomCode)) {
      const state = rooms.get(roomCode);
      clearPvpForPlayer(state, socket.id);
      const p = state.players.find((x) => x.id === socket.id);
      if (p) p.id = null;
      const anyConnected = state.players.some((x) => x.id != null);
      if (!anyConnected) {
        scheduleRoomExpire(roomCode);
        persistRooms();
      } else {
        io.to(roomCode).emit("state", state);
      }
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms.has(roomCode)) {
      const state = rooms.get(roomCode);
      clearPvpForPlayer(state, socket.id);
      const p = state.players.find((x) => x.id === socket.id);
      if (p) p.id = null;
      const anyConnected = state.players.some((x) => x.id != null);
      if (!anyConnected) {
        scheduleRoomExpire(roomCode);
        persistRooms();
      } else {
        io.to(roomCode).emit("state", state);
      }
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
