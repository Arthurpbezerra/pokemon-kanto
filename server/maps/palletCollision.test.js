import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isBlocked, isLegalMove, canInteract, DEFAULT_SPAWN, getWarp, findOpenTile } from "./pallet.js";

describe("pallet collision", () => {
  it("blocks water and house bodies using FireRed map.bin", () => {
    assert.equal(isBlocked("pallet_town", 6, 5), true);
    assert.equal(isBlocked("pallet_town", 8, 18), true);
    assert.equal(isBlocked("pallet_town", 6, 8), false);
  });

  it("blocks the Route 1 exit in this demo", () => {
    assert.equal(isBlocked("pallet_town", 12, 0), true);
    assert.equal(isBlocked("pallet_town", 13, 1), true);
  });

  it("allows adjacent walkable steps", () => {
    assert.equal(
      isLegalMove({ mapId: "pallet_town", x: 6, y: 8 }, { mapId: "pallet_town", x: 7, y: 8 }),
      true
    );
  });

  it("rejects teleport hacks", () => {
    assert.equal(
      isLegalMove({ mapId: "pallet_town", x: 6, y: 8 }, { mapId: "pallet_town", x: 0, y: 0 }),
      false
    );
    assert.equal(
      isLegalMove({ mapId: "pallet_town", x: 6, y: 8 }, { mapId: "pallet_oak_lab", x: 6, y: 12 }),
      false
    );
  });

  it("allows house warp from the FireRed door tile", () => {
    const warp = getWarp("pallet_town", 6, 7);
    assert.ok(warp);
    assert.equal(
      isLegalMove({ mapId: "pallet_town", x: 6, y: 7 }, { mapId: warp.toMapId, x: warp.toX, y: warp.toY }),
      true
    );
  });

  it("rejects occupied destination", () => {
    assert.equal(
      isLegalMove(
        { mapId: "pallet_town", x: 6, y: 8 },
        { mapId: "pallet_town", x: 7, y: 8 },
        [{ mapId: "pallet_town", x: 7, y: 8 }]
      ),
      false
    );
  });

  it("requires facing adjacency to interact", () => {
    assert.equal(
      canInteract({ mapId: "pallet_town", x: 6, y: 8 }, "up", { mapId: "pallet_town", x: 6, y: 7 }),
      true
    );
    assert.equal(
      canInteract({ mapId: "pallet_town", x: 6, y: 8 }, "down", { mapId: "pallet_town", x: 6, y: 7 }),
      false
    );
    assert.equal(
      canInteract({ mapId: "pallet_town", x: 6, y: 8 }, "up", { mapId: "pallet_oak_lab", x: 6, y: 12 }),
      false
    );
  });

  it("keeps default spawn walkable", () => {
    assert.equal(isBlocked(DEFAULT_SPAWN.mapId, DEFAULT_SPAWN.x, DEFAULT_SPAWN.y), false);
  });

  it("finds a free tile next to an occupied spawn", () => {
    const occupied = [{ mapId: "pallet_town", x: DEFAULT_SPAWN.x, y: DEFAULT_SPAWN.y }];
    const open = findOpenTile("pallet_town", DEFAULT_SPAWN, occupied);
    assert.equal(open.mapId, "pallet_town");
    assert.equal(isBlocked(open.mapId, open.x, open.y), false);
    assert.equal(open.x === DEFAULT_SPAWN.x && open.y === DEFAULT_SPAWN.y, false);
  });
});
