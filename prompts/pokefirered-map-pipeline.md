# FireRed map pipeline prompt

Use this document when adding or changing Pallet Town maps, collision, warps, NPCs, sprites, or multiplayer interactivity. Follow it strictly to avoid silent drift between bake output, client registry, and server authority.

## Goal

Keep one coherent pipeline:

```text
vendor/pokefirered/          pret slice (source of truth for bake)
        ↓ npm run maps
public/assets/pokefirered/   runtime PNGs + overworld sprites
shared collision JSON        src/world + server/maps
src/world/palletMaps.ts      client registry (URLs, warps, NPCs)
server/maps/pallet.js        server authority (warps, collision, NPC tiles)
Phaser OverworldScene        rendering + local prediction
Socket.IO server             authoritative movement + interaction
```

## Non-negotiable rules

1. **Never edit baked PNGs by hand.** Regenerate with `npm run maps`.
2. **Never load `/assets/...` without `publicUrl()`.** GitHub Pages lives under `/pokemon-kanto/`.
3. **Never duplicate map metadata in three places without updating all three.** Today that means:
   - `scripts/build-firered-maps.mjs` (`maps[]`, collision overrides)
   - `src/world/palletMaps.ts`
   - `server/maps/pallet.js`
4. **Fail fast.** If vendor files, PNG dimensions, or collision JSON diverge, stop and fix before shipping.
5. **Do not copy pret `graphics/` whole.** Only the minimal slice in `vendor/pokefirered/`.
6. **Do not add silent fallbacks** such as defaulting unknown map IDs to walkable tiles or skipping missing assets.

## Directory contract

### Source (`vendor/pokefirered/`)

Required for current Pallet demo:

```text
vendor/pokefirered/
  data/layouts/
    PalletTown/map.bin
    PalletTown_PlayersHouse_1F/map.bin
    PalletTown_PlayersHouse_2F/map.bin
    PalletTown_RivalsHouse/map.bin
    PalletTown_ProfessorOaksLab/map.bin
  data/tilesets/
    primary/general/
    primary/building/
    secondary/pallet_town/
    secondary/generic_building_1/
    secondary/generic_building_2/
    secondary/lab/
  data/maps/<MapName>/map.json
  object_events/pics/people/*.png
```

Each tileset directory must contain:

- `tiles.4bpp`
- `metatiles.bin`
- `metatile_attributes.bin`
- `palettes/00.pal` … `15.pal`

Refresh source from pret with:

```bash
npm run vendor:copy
```

### Runtime (`public/assets/pokefirered/`)

```text
public/assets/pokefirered/
  maps/<map_id>/ground.png
  maps/<map_id>/overlay.png
  overworld/<sprite>.png
```

Current map IDs:

- `pallet_town`
- `pallet_player_house_1f`
- `pallet_player_house_2f`
- `pallet_rival_house_1f`
- `pallet_oak_lab`

## Bake invariants

### Constants

- Tile size: **16 px**
- Primary tile/metatile cap: **640**
- PNG output: RGBA 8-bit
- Collision chars: `.` walkable, `#` blocked

### `map.bin` decoding

For each cell (u16 little-endian):

- bits 0–9: metatile id
- bits 10–11: collision nibble
- `< 640` uses primary tileset, `>= 640` uses secondary

### Metatile rendering

- 8 tile words per metatile
- words 0–3 = bottom layer
- words 4–7 = top layer
- layer type from attributes:
  - `0` → draw top on ground
  - non-zero → draw top on overlay (Y-sorted in Phaser)

### Collision derivation

A tile is blocked when:

- collision nibble `!== 0`, OR
- metatile behavior is in water set `{0x10,0x11,0x12,0x13,0x15,0x16,0x17,0x1a,0x1b}`

Then apply explicit demo overrides in `build-firered-maps.mjs`:

| Map | Override purpose |
|---|---|
| `pallet_town` | Block Route 1 exit at `(12,0)`, `(13,0)`, `(12,1)`, `(13,1)` |
| `pallet_town` | Open door tiles `(6,7)`, `(15,7)`, `(16,13)` |
| `pallet_player_house_2f` | Open stairs warp tile `(10,2)` |

Document every override. Do not patch collision in TS/JS by hand.

## Map registry contract

When adding a map, update all of the following with identical dimensions and warp topology:

| Field | Client (`palletMaps.ts`) | Server (`pallet.js`) |
|---|---|---|
| `id` | yes | yes |
| `widthTiles` / `heightTiles` | yes | yes |
| `spawn` | yes | yes |
| `warps[]` x,y,w,h,toMapId,toX,toY | yes | yes |
| collision rows | via JSON import | via JSON read |
| NPC positions | `PALLET_NPCS` | `NPC_TILES` |

### Warp rules

- Source warp rects must match pret `map.json` `warp_events`
- Destination tiles must be walkable in collision JSON
- Server validates warp only when player steps from a source warp tile
- Use `findOpenTile()` at destination if another player occupies `(toX,toY)`

Current warp graph:

```text
pallet_town (6,7) -> pallet_player_house_1f (5,8)
pallet_town (15,7) -> pallet_rival_house_1f (5,8)
pallet_town (16,13) -> pallet_oak_lab (6,12)

pallet_player_house_1f (4-5,8) -> pallet_town (6,8)
pallet_player_house_1f (10,2) -> pallet_player_house_2f (10,3)

pallet_player_house_2f (10,2) -> pallet_player_house_1f (10,3)

pallet_rival_house_1f (3-5,8) -> pallet_town (15,8)

pallet_oak_lab (5-7,12) -> pallet_town (16,14)
```

## NPC contract

NPCs must exist in both:

- `PALLET_NPCS` in `src/world/palletMaps.ts` (render + dialog)
- `NPC_TILES` in `server/maps/pallet.js` (movement blocking)

Current NPCs:

| map | x,y | sprite | notes |
|---|---|---|---|
| pallet_town | 3,10 | ow-woman | townsfolk |
| pallet_town | 13,17 | ow-fat-man | townsfolk |
| pallet_player_house_1f | 8,4 | ow-mom | heal dialog |
| pallet_rival_house_1f | 10,6 | ow-daisy | dialog |
| pallet_oak_lab | 6,3 | ow-oak | dialog |

Use pret `map.json` `object_events` as reference. Only implement the subset needed for the demo, but keep positions exact.

## Overworld sprite contract

Runtime strips live in `public/assets/pokefirered/overworld/`.

Phaser expects FireRed 16×32 strips:

- frame 0 down idle
- frame 1 up idle
- frame 2 side idle
- frames 3–4 down walk
- frames 5–6 up walk
- frames 7–8 side walk
- east = west + `flipX`

Implementation lives in `src/game/phaser/art/overworldSprites.ts`.

Do not swap in raw pret 2×4 meta sheets without converting to the 9-frame strip layout.

## Multiplayer / interaction contract

### Movement authority

Server function: `isLegalMove(from, to, occupied)`

Reject when:

- destination out of bounds
- destination blocked by collision or NPC tile
- destination occupied by another player
- cross-map move without valid warp
- Manhattan distance ≠ 1 (except same-tile noop / warp)

On rejection, server emits `moveRejected` with authoritative position.

### Interaction authority

Player-to-player interaction requires:

- same `mapId`
- Manhattan distance = 1
- initiator facing the target tile

Functions:

- client: `canInteractPlayers()`
- server: `canInteract()`

Use this for talk / PvP challenge / trade menus.

### Presence sync

- emit movement with `moving: true/false`
- heartbeat every ~2s on same map
- filter remote players by `mapId`
- spawn via `findOpenTile()` to avoid stacking

## Phaser rendering contract

`OverworldScene.ts` must:

1. Load `ground.png` at depth 0
2. Load `overlay.png` as horizontal strips per tile row for Y-sort
3. Place player/NPC sprites with origin `(0.5, 1)` at tile bottom center
4. Depth = base + tile Y
5. Use `roundPixels: true`

If a player walks "under" a roof incorrectly, fix overlay strip depth — do not move collision.

## Commands

```bash
npm run vendor:copy     # refresh vendor/pokefirered from ../pokefirered
npm run maps            # bake PNGs + collision JSON
npm run maps:validate   # PNG dims + collision parity checks
npm test                # server tests + validate-maps
npm run build           # production bundle
npx tsc --noEmit        # typecheck
```

Run `npm run maps` twice in a row. If outputs change, the bake is non-deterministic — fix before commit.

## Validation matrix

### Bake

- [ ] all 5 map IDs produce ground + overlay PNG
- [ ] PNG size = `widthTiles*16` by `heightTiles*16`
- [ ] collision rows match map dimensions
- [ ] client/server collision JSON byte-identical

### Registry parity

- [ ] `palletMaps.ts` and `pallet.js` agree on dimensions, spawns, warps
- [ ] every NPC in `PALLET_NPCS` appears in `NPC_TILES`
- [ ] every warp destination tile is walkable

### Gameplay smoke

- [ ] Pallet Town renders on GitHub Pages base path
- [ ] enter/exit all three buildings + 2F stairs
- [ ] collision blocks water, houses, map edge
- [ ] Route 1 north exit blocked
- [ ] NPC dialog works when facing adjacent tile
- [ ] two browsers see each other move in real time
- [ ] facing/interaction only works when directly adjacent and facing

### Deploy

- [ ] `public/assets/pokefirered/**` committed
- [ ] no references remain to `assets/fr`, `assets/Pallet`, or flat screenshot maps
- [ ] GitHub Actions does not require pret at build time

## Adding a new map (checklist)

1. Copy pret layout + tilesets into `vendor/pokefirered/`
2. Add map spec to `scripts/build-firered-maps.mjs`
3. Run `npm run maps`
4. Add registry entry to `src/world/palletMaps.ts`
5. Add mirror entry to `server/maps/pallet.js`
6. Add NPCs to both client and server lists
7. Extend `server/maps/palletCollision.test.js`
8. Run `npm test`, `npm run build`, `npx tsc --noEmit`
9. Manual warp/interaction smoke test

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Black map on Pages | asset URL missing `publicUrl()` / BASE_URL | fix paths to `assets/pokefirered/...` |
| Player spins/wrong facing | wrong strip frame mapping | fix `overworldSprites.ts` |
| Walk through walls locally but not online | client collision diverged from server JSON | regenerate maps, sync JSON |
| Warp sends player back | destination tile blocked/occupied | verify `toX/toY` + collision |
| Door tile blocked | missing override in bake script | add `extras.cells` override |
| NPC invisible but blocks movement | missing sprite sheet or wrong `spriteKey` | sync `PALLET_NPCS` + `OW_SHEETS` |
| Two players same tile | spawn not using `findOpenTile()` | fix server join/spawn |

## Future improvement (recommended)

Generate a single manifest from pret `map.json` + baked collision and import it in both client and server. Until then, treat the three manual registries as one logical file and update them together.
