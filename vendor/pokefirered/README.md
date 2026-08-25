# FireRed vendor slice

This folder contains a **minimal, explicit subset** of assets extracted from the pret [pokefirered](https://github.com/pret/pokefirered) decompilation. It exists so `npm run maps` can rebuild Pallet Town without depending on a sibling checkout.

## Contents

- `data/layouts/*/map.bin` — map cell data for Pallet Town and interiors
- `data/tilesets/*` — tile graphics, metatiles, attributes, palettes
- `data/maps/*/map.json` — reference metadata (warps, NPCs, triggers)
- `object_events/pics/people/*.png` — source overworld sprites from pret

## Runtime outputs

The browser never loads these binary files directly. They are baked into:

- `public/assets/pokefirered/maps/*/ground.png`
- `public/assets/pokefirered/maps/*/overlay.png`
- `public/assets/pokefirered/overworld/*.png`
- `src/world/palletCollision.json`
- `server/maps/palletCollision.json`

## Refreshing from pret

If you have `../pokefirered` locally:

```bash
npm run vendor:copy
npm run maps
npm run maps:validate
```

## Legal note

Pokemon FireRed assets remain Nintendo / Game Freak / The Pokemon Company IP. This repository is a non-commercial portfolio prototype. Do not redistribute the full pret graphics tree or ROM data.
