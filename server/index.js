import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { resolvePvpTurn } from "./battle.js";

const PORT = process.env.PORT || 3001;
const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" }
});

function generateRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

const COLORS = ["red", "blue", "green", "yellow"];
const rooms = new Map();

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
      team: [],
      badges: [],
      bag: { pokeball: 10, coins: 10 },
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
    if (state.players.length >= 4) {
      socket.emit("joinError", { message: "Room is full" });
      return;
    }

    const name = (playerName || "Player").trim() || "Player";
    const newPlayer = {
      id: socket.id,
      name,
      color: COLORS[state.players.length],
      isHost: false,
      isReady: false,
      screen: "lobby",
      location: "Pallet Town",
      team: [],
      badges: [],
      bag: { pokeball: 10, coins: 10 },
      wildEncounter: null,
      encounterLog: [],
      pendingLearn: null,
      evolutionNotice: null
    };
    state.players.push(newPlayer);
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
    const mergedPlayers = (state.players || []).map((p) => {
      const existing = current.players.find((x) => x.id === p.id);
      const isSender = p.id === socket.id;
      if (isSender) {
        return {
          ...p,
          wildEncounter: state.wildEncounter ?? null,
          encounterLog: state.encounterLog ?? [],
          pendingLearn: state.pendingLearn ?? null,
          evolutionNotice: state.evolutionNotice ?? null
        };
      }
      // For other players: keep identity from server state so a buggy/stale sender can't overwrite them
      return {
        ...existing,
        ...p,
        id: p.id,
        name: existing?.name ?? p.name,
        color: existing?.color ?? p.color,
        team: existing?.team ?? p.team,
        badges: existing?.badges ?? p.badges,
        location: existing?.location ?? p.location,
        screen: existing?.screen ?? p.screen,
        bag: p.bag ?? existing?.bag,
        wildEncounter: existing?.wildEncounter ?? null,
        encounterLog: existing?.encounterLog ?? [],
        pendingLearn: existing?.pendingLearn ?? null,
        evolutionNotice: existing?.evolutionNotice ?? null
      };
    });
    const merged = { ...state, players: mergedPlayers };
    merged.wildEncounter = undefined;
    merged.encounterLog = undefined;
    merged.pendingLearn = undefined;
    merged.evolutionNotice = undefined;
    rooms.set(roomCode, merged);
    io.to(roomCode).emit("state", merged);
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
    if (!challenger?.team?.[0] || !defender?.team?.[0]) return;
    const cLead = challenger.team[0];
    const dLead = defender.team[0];
    state.pvpBattle = {
      challengerId: fromPlayerId,
      defenderId: toPlayerId,
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

  socket.on("pvpSubmitMove", (moveName) => {
    const roomCode = socket.roomCode;
    if (!roomCode || !rooms.has(roomCode)) return;
    const state = rooms.get(roomCode);
    const pvp = state.pvpBattle;
    if (!pvp || pvp.status !== "waiting_moves" || !moveName || typeof moveName !== "string") return;
    const sid = socket.id;
    if (sid === pvp.challengerId) pvp.challengerMove = moveName.trim();
    else if (sid === pvp.defenderId) pvp.defenderMove = moveName.trim();
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
      if (p.id === pvp.challengerId && p.team?.[0]) p.team[0].hp = Math.max(0, challengerHp);
      if (p.id === pvp.defenderId && p.team?.[0]) p.team[0].hp = Math.max(0, defenderHp);
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
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (state.players.length === 0) rooms.delete(roomCode);
      else io.to(roomCode).emit("state", state);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms.has(roomCode)) {
      const state = rooms.get(roomCode);
      clearPvpForPlayer(state, socket.id);
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (state.players.length === 0) rooms.delete(roomCode);
      else io.to(roomCode).emit("state", state);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
