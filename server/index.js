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
      badges: []
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
      badges: []
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
    rooms.set(roomCode, state);
    socket.to(roomCode).emit("state", state);
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

  socket.on("leaveRoom", () => {
    const roomCode = socket.roomCode;
    if (!roomCode) return;
    socket.leave(roomCode);
    socket.roomCode = null;
    if (rooms.has(roomCode)) {
      const state = rooms.get(roomCode);
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (state.players.length === 0) rooms.delete(roomCode);
      else io.to(roomCode).emit("state", state);
    }
  });

  socket.on("disconnect", () => {
    const roomCode = socket.roomCode;
    if (roomCode && rooms.has(roomCode)) {
      const state = rooms.get(roomCode);
      state.players = state.players.filter((p) => p.id !== socket.id);
      if (state.players.length === 0) rooms.delete(roomCode);
      else io.to(roomCode).emit("state", state);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server on http://localhost:${PORT}`);
});
