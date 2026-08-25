# Pallet Town Demo (pokemon-kanto)

A browser multiplayer overworld demo inspired by Pokemon FireRed Pallet Town. Players share a room, walk the same map in real time, talk to NPCs, and can challenge or trade when they stand face to face.

Live front-end: [https://arthurpbezerra.github.io/pokemon-kanto/](https://arthurpbezerra.github.io/pokemon-kanto/)

This is a personal/portfolio prototype, not a commercial product. Pokemon names, maps, and sprites remain Nintendo IP.

## Idea

The original Kanto MVP was a node-graph map (click a town, then battle). This iteration turns the starting town into a **tile-based FireRed overworld**:

- Phaser renders Pallet Town from FireRed tilesets (ground + overlay), not a stretched screenshot.
- Collision, warps, and NPC spots come from pret [pokefirered](https://github.com/pret/pokefirered) `map.bin` data.
- Socket.IO keeps other players in sync (position, facing, idle/walk).
- On phones, a GBA-style D-pad plus A/B sits on the screen.

## How it works

```
Browser (Vite/React + Phaser)
    |  Socket.IO  (VITE_WS_URL or same origin)
    v
Node server (Express + Socket.IO)
    |  rooms, playerMove, PvP turns
    v
rooms.json (short-lived persistence)
```

**Front-end (`src/`)**

- `App.tsx` — rooms, lobby, starters, battle UI, bag.
- `PalletMapScreen` + `OverworldPhaser` — Phaser canvas and mobile pad.
- `src/game/phaser` — overworld scene, FireRed walk animations, Y-sorted overlay.
- `src/world/palletMaps.ts` — map registry, warps, NPCs.

**Server (`server/`)**

- Authoritative `playerMove` (collision, warps, one player per tile).
- Room codes, reconnect by name only if that name is disconnected.
- PvP damage on the server (`battleEngine.js`).

**Maps**

- `npm run maps` rebuilds PNGs from a local pret `pokefirered` checkout (sibling folder).
- Output: `public/assets/fr/maps/<id>/ground.png` and `overlay.png`.

## Local development

Needs **two processes**:

```bash
# terminal 1 — Socket.IO
cd server
npm install
npm start          # http://localhost:3001

# terminal 2 — web UI
npm install
npm run dev        # http://localhost:5173
```

Vite proxies `/socket.io` to port 3001. Open two browsers, create a room, join with a **different** name, pick a starter, walk Pallet Town.

Same Wi-Fi (phone): run Vite with `--host` and open `http://<your-lan-ip>:5173`. `localhost` on the phone is the phone itself.

## Hosting (what this repo already uses)

The stack is split on purpose. GitHub Pages cannot run Socket.IO.

| Piece | Where | Config |
|--------|--------|--------|
| Static site | **GitHub Pages** (`gh-pages` branch) | `.github/workflows/deploy.yml` |
| Realtime server | **Render** (Node web service) | `render.yaml` |

GitHub Actions builds the Vite app with `--base=/pokemon-kanto/` so it matches [https://arthurpbezerra.github.io/pokemon-kanto/](https://arthurpbezerra.github.io/pokemon-kanto/).

Deploys currently run on push to **`dev`** (and via **Run workflow**). Pages in the GitHub repo should stay **Deploy from a branch → `gh-pages`**.

### Front-end (GitHub Pages)

1. Repo Settings → Pages → Deploy from a branch → `gh-pages` / root.
2. Settings → Secrets and variables → Actions → `VITE_WS_URL` = your Render URL, for example `https://pokemon-kanto-server.onrender.com` (no trailing slash).
3. Push to `dev` (or run the **Deploy to GitHub Pages** workflow).

If `VITE_WS_URL` is missing, the built site talks to `window.location.origin` (Pages), which has **no** game server.

### Back-end (Render)

[`render.yaml`](render.yaml) describes a free Node service:

- Name: `pokemon-kanto-server`
- Root: `server/`
- Start: `npm start`
- CORS: `origin: "*"` in `server/index.js`

On [render.com](https://render.com): New → Blueprint, or Web Service from this GitHub repo, root directory `server`, start command `npm start`. Copy the `https://….onrender.com` URL into `VITE_WS_URL`, then rebuild the front-end.

Free Render services spin down when idle. The first join after a pause can take ~30s.

`vercel.json` can host the static front-end too. Socket.IO still needs Render (or another always-on Node host). Do not expect Vercel serverless to replace the Socket.IO process.

## Scripts

| Command | What it does |
|---------|----------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production front-end |
| `npm run maps` | Rebuild Pallet maps from pret |
| `npm test` / `npm --prefix server test` | Collision and battle tests |

## Notes

Walk animations follow FireRed 16x32 strips (idle 0–2, walk 3–8, east = west + flip). Overlay tiles are drawn in Y-sorted strips so rugs and furniture do not always cover the player.

Reconnect uses the same display name only when that player is **offline**. Two people cannot sit in the room with the same name at once.
