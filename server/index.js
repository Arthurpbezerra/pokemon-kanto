import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

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
