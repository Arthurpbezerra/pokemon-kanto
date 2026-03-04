# 🎮 Pokémon Kanto Multiplayer Web Game — Development Prompt

## Project Overview

Build a **multiplayer Pokémon browser game** set in the Kanto region with up to 4 players. The game uses the PokéAPI (https://pokeapi.co) for all Pokémon data and is built as a single-page React application with real-time multiplayer state managed via a shared in-memory store (or Firebase Realtime Database if persistence is needed). The aesthetic should be **retro pixel-art RPG** — inspired by the original Game Boy Color games, using pixel fonts, tile-based maps, and a warm nostalgic color palette.

---

## Tech Stack

- **Frontend**: React (JSX) with Tailwind core utilities
- **State**: React `useState` / `useReducer` + `useContext` for global game state; optionally backed by `window.storage` for persistence
- **Multiplayer**: Simulated via shared React context (single-browser for demo); architecture should be designed so it can plug into Firebase or WebSockets
- **Data**: PokéAPI REST (`https://pokeapi.co/api/v2/`) for Pokémon sprites, stats, moves, and evolution chains
- **Styling**: Tailwind utilities + custom inline styles for pixel-art aesthetics
- **Fonts**: `Press Start 2P` (Google Fonts) for all UI text

---

## Visual Design & Aesthetic

- **Theme**: Retro pixel RPG — dark olive/forest green primary, warm amber accents, cream backgrounds for UI panels
- **Font**: `Press Start 2P` everywhere, size scaled down (8–10px body, 12–14px headers)
- **Colors**:
  - Background: `#1a1a2e` (deep navy night sky)
  - Map tiles: Grid of colored squares representing terrain (grass=`#4ade80`, town=`#fbbf24`, road=`#d4d4aa`, water=`#60a5fa`, cave=`#a16207`)
  - UI panels: `#2d2d44` with `#fbbf24` borders, pixelated box-shadow
  - Player colors: Red, Blue, Green, Yellow (one per player slot)
- **Map rendering**: CSS Grid of tile cells, each ~48×48px, click-navigable
- **Pokémon sprites**: Use PokéAPI front sprites (`https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/{id}.png`)
- **Animations**: CSS pixel-flash on capture, slide-in for battles, shake on flee

---

## Game Flow

### Phase 1: Lobby

1. Player 1 ("Host") opens the game and enters a display name → creates a lobby with a 4-character room code
2. Players 2–4 enter the room code + display name to join (simulate joining by clicking "Join as Player 2/3/4" for demo)
3. Lobby shows all connected players with their chosen color and a **"READY"** status toggle
4. Host sees a **"START GAME"** button — enabled only when ≥ 2 players are ready (or host can force start)
5. Lobby UI: large room code displayed, animated waiting dots, player cards with color badges

### Phase 2: Starter Selection

1. All players simultaneously see the 3 Gen 1 starters: **Bulbasaur (#1)**, **Charmander (#4)**, **Squirtle (#7)**
2. Each player clicks their choice — once chosen, it locks in (other players see "TAKEN" overlay if same picked — or allow duplicates for simplicity)
3. Fetch starter data from PokéAPI: name, sprite, base stats (HP, Attack, Defense, Speed)
4. Once all players have selected → transition to the Map Screen
5. Each player starts at **Pallet Town** with their starter Pokémon at **Level 5**, **0 XP**

### Phase 3: The Kanto Map

#### Map Layout (Node Graph)

Represent the Kanto map as a **graph of named locations**, each being a clickable node. Display as a stylized top-down pixel map using a CSS grid where each location is a colored tile/card. Clicking an **adjacent** location moves the player there.

**Locations & connections:**

```
Pallet Town → Route 1 → Viridian City → Route 2 → Pewter City
Pewter City → Mt. Moon Route → Cerulean City
Cerulean City → Route 24/25 (Grass) → Bill's Sea Cottage
Cerulean City → Route 5/6 → Vermilion City
Vermilion City → Route 11 → Route 12 → Lavender Town
Lavender Town → Route 10 (Grass) → Cerulean City (loop)
Lavender Town → Route 7/8 → Celadon City
Celadon City → Route 16/17/18 → Fuchsia City
Fuchsia City → Route 19/20 (Water) → Cinnabar Island
Cinnabar Island → Route 21 → Pallet Town (loop)
Fuchsia City → Route 15/14/13 → Lavender Town
Celadon City → Route 9 → Lavender Town
```

Each location has a **type**:
- `town` — safe zone, Pokémon Center (heal team), Player vs Player battle available
- `grass` — wild Pokémon encounters pool available, no healing
- `cave/water` — wild encounters, different Pokémon pool

#### Location Data Structure

```js
const LOCATIONS = {
  "Pallet Town": {
    type: "town",
    connections: ["Route 1"],
    gym: null,
    wildPool: [],
    description: "Your journey begins here."
  },
  "Route 1": {
    type: "grass",
    connections: ["Pallet Town", "Viridian City"],
    gym: null,
    wildPool: [16, 19, 21], // Pidgey, Rattata, Spearow
    description: "A grassy path north of Pallet Town."
  },
  // ... etc for all locations
}
```

#### Gym Leaders (Towns with Gyms)

| Town | Gym Leader | Badge | Type | Ace Pokémon | Level |
|---|---|---|---|---|---|
| Pewter City | Brock | Boulder | Rock | Onix (#95) | 14 |
| Cerulean City | Misty | Cascade | Water | Starmie (#121) | 21 |
| Vermilion City | Lt. Surge | Thunder | Electric | Raichu (#26) | 28 |
| Celadon City | Erika | Rainbow | Grass | Vileplume (#45) | 35 |
| Fuchsia City | Koga | Soul | Poison | Weezing (#110) | 43 |
| Saffron City | Sabrina | Marsh | Psychic | Alakazam (#65) | 50 |
| Cinnabar Island | Blaine | Volcano | Fire | Arcanine (#59) | 54 |
| Viridian City | Giovanni | Earth | Ground | Rhydon (#112) | 60 |

Each player tracks which **badges** they've earned (array of badge names). A player must have the prior badge to challenge the next gym (or just show them in order without gating for simplicity).

---

## Core Game Systems

### Pokémon Data Model

```js
{
  id: 4,                    // PokéAPI id
  name: "Charmander",
  sprite: "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/4.png",
  level: 5,
  xp: 0,
  xpToNext: 100,            // increases per level
  hp: 39,                   // current HP
  maxHp: 39,                // calculated from base stat + level
  stats: { attack, defense, speed, specialAttack, specialDefense },
  moves: ["Scratch", "Growl"],   // first 4 moves from PokéAPI
  isFainted: false,
  isStarter: true
}
```

### Wild Pokémon Encounters

- Triggered **automatically** when a player moves to a `grass`/`cave`/`water` location
- Show a battle panel: wild Pokémon sprite + name + level (random between location's level range)
- Player options: **CAPTURE** or **FLEE**

**Capture mechanic:**
- Roll `Math.random()`
- `< 0.80` → success: add Pokémon to team (max 6; if full, offer to release one)
- `>= 0.80` → fail: Pokémon flees, show flee animation

**XP on encounter** (whether captured or fled): Lead Pokémon gains small XP (5–15)

### Leveling & Evolution

- XP thresholds: `level * 50` XP needed to level up (simple linear formula)
- On level up: recalculate stats using PokéAPI base stats formula, display level-up animation
- **Evolution**: Check PokéAPI evolution chain for the Pokémon
  - Starters evolve at levels 16 and 36 (Bulbasaur→Ivysaur→Venusaur, etc.)
  - On reaching evolution level: show evolution animation, fetch evolved Pokémon data, replace in team
  - Prompt: "Your [Pokémon] is evolving!" with a white flash CSS animation

### Player vs Player (PvP) Battle

- Available when two players are in the **same town**
- Either player can challenge the other; challenged player sees a notification and can Accept/Decline
- **Battle system** (turn-based, simplified):
  - Each turn: both players secretly pick a move (or auto-pick highest damage move for speed)
  - Damage formula: `Math.floor((attack / defense) * movePower * (Math.random() * 0.2 + 0.9))`
  - Show HP bars animating down, move names displayed
  - When all 6 Pokémon faint → loser loses, winner gains XP for all their Pokémon
  - Fainted Pokémon recover to 1 HP after battle (no permadeath)
- For demo: can be simulated with one browser, player A and player B take turns clicking

### Gym Leader Battle

- Available when player is in a **gym town** and has **earned the prior badge**
- Same battle system as PvP, but opponent is AI-controlled
- AI: always uses the move with highest base power
- Gym team: 2–3 Pokémon with the leader's ace as final
- On win: award badge, give XP, show badge display

---

## UI Screens / Components

### 1. `<LobbyScreen />`
- Room code display (large pixelated text)
- 4 player slots with name, color indicator, ready toggle
- "Start Game" button (host only)
- Animated pixel Pokéball spinning as waiting indicator

### 2. `<StarterSelectScreen />`
- 3 starter cards side by side with sprite, name, types, base stats bar chart
- Click to select — selected card highlights with gold border + glow
- Player indicators below each starter showing who picked what
- "CONFIRM" button locks in selection

### 3. `<MapScreen />`
- Left panel (60%): Visual Kanto map as CSS grid
  - Each location is a colored cell with its name
  - Current player's location highlighted with player color border + pulse animation
  - Other players shown as colored dots on their location
  - Clicking an **adjacent** location moves the player there
  - Non-adjacent locations are grayed out / not clickable
- Right panel (40%): Player dashboard
  - Player name, badges earned (badge icons as colored circles)
  - Team display: up to 6 Pokémon mini-cards showing sprite, name, level, HP bar
  - "Active Pokémon" large display at top
  - Event log: last 5 actions (e.g., "You caught a Pidgey!", "Bulbasaur grew to Lv 8!")

### 4. `<WildEncounterModal />`
- Full-screen overlay with animated grass rustling CSS effect
- Wild Pokémon sprite (large, centered) with name + level
- Your lead Pokémon sprite (smaller) at bottom left
- Two big buttons: **"CAPTURE!"** (green) and **"FLEE"** (gray)
- Capture result: flash green + "Gotcha!" OR flash red + "[Pokémon] fled!"

### 5. `<BattleScreen />`
- Classic RPG battle layout: opponent Pokémon top-right, player Pokémon bottom-left
- HP bars for both active Pokémon with animated depletion
- Move selection: 4 buttons (or auto-battle toggle)
- Battle log scrolling text box
- "Switch Pokémon" button

### 6. `<GymBattleModal />`
- Same as BattleScreen but with gym leader portrait placeholder, badge display on win

### 7. `<TeamPanel />`
- Shows all 6 Pokémon slots
- Each slot: sprite, name, level, HP bar, XP bar
- Click to set as lead Pokémon

---

## State Architecture

```js
const initialGameState = {
  phase: "lobby",           // "lobby" | "starter" | "map" | "encounter" | "battle"
  roomCode: "AB12",
  players: [
    {
      id: "p1",
      name: "Ash",
      color: "red",
      isHost: true,
      isReady: false,
      location: "Pallet Town",
      team: [],             // array of Pokémon objects
      badges: [],
      starter: null
    }
    // up to 4 players
  ],
  currentPlayerId: "p1",    // which player this browser is controlling
  wildEncounter: null,      // { pokemon, location } or null
  activeBattle: null,       // { type: "pvp"|"gym", opponent, turn, log } or null
}
```

---

## PokéAPI Integration Notes

- Base URL: `https://pokeapi.co/api/v2/`
- Fetch Pokémon by ID: `/pokemon/{id}`
  - Use: `sprites.front_default`, `base_experience`, `stats[]`, `moves[]`
- Fetch evolution chain: `/pokemon-species/{id}` → `evolution_chain.url` → fetch that URL
- Cache all fetched data in a `Map` to avoid redundant API calls
- Load starters on game start; wild Pokémon data loaded lazily on encounter

**Gen 1 Pokémon IDs**: 1–151

**Wild Pokémon pools by location** (sample):
- Route 1: [16 Pidgey, 19 Rattata]
- Route 2: [16 Pidgey, 19 Rattata, 21 Spearow]
- Mt. Moon Route: [35 Clefairy, 41 Zubat, 74 Geodude]
- Cerulean Grass: [43 Oddish, 60 Poliwag, 118 Goldeen]
- Safari/Fuchsia Grass: [111 Rhyhorn, 115 Kangaskhan, 123 Scyther]

---

## Implementation Instructions

1. **Start with the Lobby** — get player joining and the start button working first
2. **Build Starter Selection** — fetch 3 starters from PokéAPI, display, allow selection
3. **Build the Map** — hardcode the location graph, render as grid, implement click-to-move
4. **Wild Encounters** — on grass move, trigger encounter modal, implement capture roll
5. **Leveling system** — XP accumulation, level up, stat recalculation
6. **Evolution** — check thresholds after level up, fetch evolved form
7. **PvP Battle** — turn-based battle between two players' teams
8. **Gym Battles** — AI-controlled gym leader teams
9. **Polish** — animations, sound feedback (CSS-only), badge display, event log

---

## Extra Polish Details

- Pokéball SVG animation on capture attempt (spinning then snapping shut)
- Pixel-art HP bar that changes color: green→yellow→red as HP decreases
- Level-up fanfare: yellow flash + "Level Up!" text bouncing in
- Evolution: white screen wipe → new Pokémon sprite fades in
- Map: player location pulses softly with the player's color
- Event log entries fade in one by one
- All buttons have `:active` pixel-press effect (translate 2px down, shadow shrinks)
- `Press Start 2P` font loaded from Google Fonts CDN in the HTML head

---

## Scope Notes for MVP

For a single-artifact deliverable, simulate multiplayer within one browser window:
- Show a player selector at top ("Playing as: [P1] [P2] [P3] [P4]") — clicking switches your perspective
- Each player has independent state (location, team, badges)
- PvP battle is available when you switch to Player 2 and both are in the same town
- This allows full gameplay testing without a backend

The code architecture should make it straightforward to replace this with Firebase or WebSocket real-time sync later.
