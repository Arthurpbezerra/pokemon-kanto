import * as Phaser from "phaser";
import type { Direction, TilePosition } from "../../../world/tileWorld";
import {
  PALLET_MAPS,
  facingTile,
  getPalletMap,
  getWarpAt,
  isBlockedTile,
  npcAt,
  npcsOnMap,
  type MapNpc,
} from "../../../world/palletMaps";
import { getDirectionFromControls, type ControlState } from "../input/controls";
import {
  applyFacingFlip,
  ensureWalkAnims,
  idleFrame,
  playWalk,
  playerSheetKey,
  queueOverworldSheets,
  stopWalk,
} from "../art/overworldSprites";

export type NearbyPlayer = {
  id: string;
  name: string;
  color: string;
  tilePos?: TilePosition;
  spriteId?: string;
  facing?: Direction;
  moving?: boolean;
  inBattle?: boolean;
};

export type PhaserBridgeState = {
  playerId: string;
  playerColor?: string;
  tilePos: TilePosition;
  spriteId?: string;
  nearbyPlayers: NearbyPlayer[];
  canEncounter: boolean;
};

export type PhaserBridgeCallbacks = {
  onUpdateTilePos?: (playerId: string, next: TilePosition, facing: Direction, moving: boolean) => void;
  onTravel?: (toLocation: string, spawnTile?: TilePosition) => void;
  onSearchWild?: () => void;
  onStayHere?: () => void;
  onNpcInteract?: (npc: MapNpc) => void;
  onPlayerInteract?: (playerId: string) => void;
  onBlockedMessage?: (message: string) => void;
};

type RemoteActor = {
  container: Phaser.GameObjects.Container;
  sprite: Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Container;
  sheetKey: string;
  lastSeqPosition: string;
  lastLabel: string;
};

const STEP_MS = 110;
const DEPTH_GROUND = 0;
const DEPTH_SORT = 20;
const DEPTH_UI = 100;

function tileCenter(tile: number, tileSize: number) {
  return tile * tileSize + tileSize / 2;
}

function rowDepth(tileY: number) {
  return DEPTH_SORT + tileY * 2;
}

function actorDepth(tileY: number) {
  return rowDepth(tileY) + 1;
}

function nameTagText(name: string, inBattle?: boolean) {
  const short = (name || "?").trim().slice(0, 10);
  return inBattle ? `${short} •` : short;
}

function createNameTag(scene: Phaser.Scene, name: string, inBattle?: boolean) {
  const text = scene.add
    .text(0, 0, nameTagText(name, inBattle), {
      fontFamily: '"Press Start 2P", monospace',
      fontSize: 8,
      color: inBattle ? "#ffe08a" : "#fff8e1",
      stroke: "#2a2030",
      strokeThickness: 3,
      align: "center",
    })
    .setOrigin(0.5, 1)
    .setResolution(4);
  text.setPadding(1, 1, 1, 1);
  return scene.add.container(0, -18, [text]);
}

export class OverworldScene extends Phaser.Scene {
  private bridgeState: PhaserBridgeState;
  private callbacks: PhaserBridgeCallbacks;
  private mapData = getPalletMap("pallet_town");
  private mapObjects: Phaser.GameObjects.GameObject[] = [];
  private player: Phaser.GameObjects.Sprite | null = null;
  private playerShadow: Phaser.GameObjects.Ellipse | null = null;
  private playerSheetKey = "";
  private remotes = new Map<string, RemoteActor>();
  private controls: ControlState = { up: false, down: false, left: false, right: false };
  private pad: ControlState = { up: false, down: false, left: false, right: false };
  private interactQueued = false;
  private facing: Direction = "down";
  private moving = false;
  private stepCooldown = 0;
  private ready = false;
  private interactKey?: Phaser.Input.Keyboard.Key;
  private zKey?: Phaser.Input.Keyboard.Key;
  private enterKey?: Phaser.Input.Keyboard.Key;
  private spaceKey?: Phaser.Input.Keyboard.Key;
  private statusText: Phaser.GameObjects.Text | null = null;
  private idleEmitted = true;
  private readonly cameraTilesW = 15;
  private readonly cameraTilesH = 10;

  constructor(state: PhaserBridgeState, callbacks: PhaserBridgeCallbacks) {
    super("OverworldScene");
    this.bridgeState = state;
    this.callbacks = callbacks;
    this.mapData = getPalletMap(state.tilePos.mapId);
  }

  preload() {
    queueOverworldSheets(this);
    for (const map of Object.values(PALLET_MAPS)) {
      this.load.image(`map-${map.id}-ground`, map.mapImageUrl);
      if (map.overlayImageUrl) this.load.image(`map-${map.id}-overlay`, map.overlayImageUrl);
    }
  }

  public syncBridgeState(next: PhaserBridgeState) {
    const nextState = { ...next, tilePos: { ...next.tilePos, mapId: getPalletMap(next.tilePos.mapId).id } };
    const mapChanged = nextState.tilePos.mapId !== this.mapData.id;
    const spriteChanged = next.spriteId !== this.bridgeState.spriteId;
    this.bridgeState = nextState;

    if (mapChanged) {
      this.loadMap(nextState.tilePos.mapId, nextState.tilePos);
      return;
    }
    if (spriteChanged && this.ready) this.createOrReplaceLocalPlayer();
    if (!this.moving && this.player) {
      const px = tileCenter(nextState.tilePos.x, this.mapData.tileSize);
      const py = tileCenter(nextState.tilePos.y, this.mapData.tileSize);
      if (Math.abs(this.player.x - px) > 2 || Math.abs(this.player.y - (py + 8)) > 2) {
        this.positionLocalActor(nextState.tilePos.x, nextState.tilePos.y);
      }
    }
    this.syncRemotePlayers(next.nearbyPlayers);
  }

  public setPadDirection(direction: Direction | null) {
    this.pad = { up: false, down: false, left: false, right: false };
    if (direction) this.pad[direction] = true;
  }

  public queueInteract() {
    this.interactQueued = true;
  }

  create() {
    this.cameras.main.roundPixels = true;
    this.bindControls();
    const kb = this.input.keyboard;
    this.interactKey = kb?.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.zKey = kb?.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.enterKey = kb?.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER);
    this.spaceKey = kb?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.scale.on("resize", () => this.applyCameraZoom());
    this.loadMap(this.bridgeState.tilePos.mapId, this.bridgeState.tilePos);
  }

  private bindControls() {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    const bind = (key: string, direction: keyof ControlState) => {
      keyboard.on(`keydown-${key}`, () => (this.controls[direction] = true));
      keyboard.on(`keyup-${key}`, () => (this.controls[direction] = false));
    };
    bind("W", "up");
    bind("S", "down");
    bind("A", "left");
    bind("D", "right");
    const cursors = keyboard.createCursorKeys();
    cursors.up.on("down", () => (this.controls.up = true));
    cursors.up.on("up", () => (this.controls.up = false));
    cursors.down.on("down", () => (this.controls.down = true));
    cursors.down.on("up", () => (this.controls.down = false));
    cursors.left.on("down", () => (this.controls.left = true));
    cursors.left.on("up", () => (this.controls.left = false));
    cursors.right.on("down", () => (this.controls.right = true));
    cursors.right.on("up", () => (this.controls.right = false));
  }

  private loadMap(mapId: string, requestedSpawn: TilePosition) {
    this.ready = false;
    this.showStatus("Loading Pallet Town...");
    this.clearMap();
    this.mapData = getPalletMap(mapId);
    const extra = npcsOnMap(this.mapData.id).map((n) => ({ x: n.x, y: n.y }));
    const spawn = {
      mapId: this.mapData.id,
      x: Phaser.Math.Clamp(Math.round(requestedSpawn.x), 0, this.mapData.widthTiles - 1),
      y: Phaser.Math.Clamp(Math.round(requestedSpawn.y), 0, this.mapData.heightTiles - 1),
    };
    if (isBlockedTile(this.mapData, spawn.x, spawn.y, extra)) {
      spawn.x = this.mapData.spawn.x;
      spawn.y = this.mapData.spawn.y;
    }
    this.bridgeState = { ...this.bridgeState, tilePos: spawn };

    const groundKey = `map-${this.mapData.id}-ground`;
    const overlayKey = `map-${this.mapData.id}-overlay`;
    const draw = () => {
      try {
        this.renderMap();
        const worldWidth = this.mapData.widthTiles * this.mapData.tileSize;
        const worldHeight = this.mapData.heightTiles * this.mapData.tileSize;
        this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
        this.physics?.world?.setBounds(0, 0, worldWidth, worldHeight);
        this.createOrReplaceLocalPlayer();
        this.positionLocalActor(spawn.x, spawn.y);
        if (this.player) this.cameras.main.startFollow(this.player, true, 0.22, 0.22);
        this.applyCameraZoom();
        this.syncRemotePlayers(this.bridgeState.nearbyPlayers);
        this.showStatus("");
        this.ready = true;
        if (requestedSpawn.mapId !== spawn.mapId || requestedSpawn.x !== spawn.x || requestedSpawn.y !== spawn.y) {
          this.callbacks.onUpdateTilePos?.(this.bridgeState.playerId, spawn, this.facing, false);
        }
      } catch (err) {
        console.error("Failed to draw Pallet map", err);
        this.showStatus("Map failed to load");
      }
    };

    const missing = [groundKey, overlayKey].filter((key) => !this.textures.exists(key));
    if (missing.length === 0) {
      draw();
      return;
    }
    if (!this.textures.exists(groundKey)) this.load.image(groundKey, this.mapData.mapImageUrl);
    if (this.mapData.overlayImageUrl && !this.textures.exists(overlayKey)) {
      this.load.image(overlayKey, this.mapData.overlayImageUrl);
    }
    this.load.once("complete", () => draw());
    if (!this.load.isLoading()) this.load.start();
  }

  private clearMap() {
    for (const object of this.mapObjects) object.destroy();
    this.mapObjects = [];
    for (const remote of this.remotes.values()) remote.container.destroy(true);
    this.remotes.clear();
  }

  private renderMap() {
    const ground = this.add.image(0, 0, `map-${this.mapData.id}-ground`).setOrigin(0).setDepth(DEPTH_GROUND);
    this.mapObjects.push(ground);
    const overlayKey = `map-${this.mapData.id}-overlay`;
    if (this.textures.exists(overlayKey)) {
      const pixelW = this.mapData.widthTiles * this.mapData.tileSize;
      const tile = this.mapData.tileSize;
      for (let y = 0; y < this.mapData.heightTiles; y++) {
        const strip = this.add.image(0, 0, overlayKey).setOrigin(0).setDepth(rowDepth(y));
        strip.setCrop(0, y * tile, pixelW, tile);
        this.mapObjects.push(strip);
      }
    }
    for (const npc of npcsOnMap(this.mapData.id)) this.spawnNpc(npc);
    const title = this.add
      .text(8, 8, this.mapData.locationName, {
        fontFamily: "monospace",
        fontSize: "8px",
        color: "#fff4cc",
        backgroundColor: "#24324acc",
        padding: { x: 4, y: 3 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH_UI);
    this.mapObjects.push(title);
  }

  private spawnNpc(npc: MapNpc) {
    if (!this.textures.exists(npc.spriteKey)) return;
    const x = tileCenter(npc.x, this.mapData.tileSize);
    const y = tileCenter(npc.y, this.mapData.tileSize);
    ensureWalkAnims(this, npc.spriteKey);
    const shadow = this.add.ellipse(x, y + 8, 10, 4, 0x172033, 0.28).setDepth(actorDepth(npc.y) - 1);
    const sprite = this.add
      .sprite(x, y + 8, npc.spriteKey, idleFrame(npc.facing || "down", npc.spriteKey))
      .setOrigin(0.5, 1)
      .setDepth(actorDepth(npc.y));
    applyFacingFlip(sprite, npc.facing || "down");
    this.mapObjects.push(shadow, sprite);
  }

  private createOrReplaceLocalPlayer() {
    const x = this.player?.x ?? 0;
    const y = this.player?.y ?? 0;
    this.player?.destroy();
    this.playerShadow?.destroy();
    this.playerSheetKey = playerSheetKey(this.bridgeState.spriteId);
    ensureWalkAnims(this, this.playerSheetKey);
    const tileY = this.bridgeState.tilePos.y;
    this.playerShadow = this.add.ellipse(x, y, 10, 4, 0x172033, 0.28).setDepth(actorDepth(tileY) - 1);
    this.player = this.add
      .sprite(x, y, this.playerSheetKey, idleFrame(this.facing, this.playerSheetKey))
      .setOrigin(0.5, 1)
      .setDepth(actorDepth(tileY));
    applyFacingFlip(this.player, this.facing);
  }

  private positionLocalActor(tileX: number, tileY: number) {
    const x = tileCenter(tileX, this.mapData.tileSize);
    const y = tileCenter(tileY, this.mapData.tileSize);
    this.player?.setPosition(x, y + 8);
    this.playerShadow?.setPosition(x, y + 6);
    this.player?.setDepth(actorDepth(tileY));
    this.playerShadow?.setDepth(actorDepth(tileY) - 1);
  }

  private applyCameraZoom() {
    const viewWidth = Math.max(1, this.scale.width);
    const viewHeight = Math.max(1, this.scale.height);
    const targetWidth = this.cameraTilesW * this.mapData.tileSize;
    const targetHeight = this.cameraTilesH * this.mapData.tileSize;
    const targetZoom = Math.max(2, Math.floor(Math.min(viewWidth / targetWidth, viewHeight / targetHeight)));
    this.cameras.main.setZoom(targetZoom);
  }

  private occupiedTiles(): { x: number; y: number }[] {
    const npcs = npcsOnMap(this.mapData.id).map((n) => ({ x: n.x, y: n.y }));
    const remotes = this.bridgeState.nearbyPlayers
      .filter((p) => p.tilePos?.mapId === this.mapData.id)
      .map((p) => ({ x: p.tilePos!.x, y: p.tilePos!.y }));
    return [...npcs, ...remotes];
  }

  private syncRemotePlayers(players: NearbyPlayer[]) {
    if (!this.player && !this.ready) return;
    const active = new Set<string>();
    players
      .filter((player) => player.tilePos?.mapId === this.mapData.id)
      .forEach((player) => {
        if (!player.tilePos) return;
        active.add(player.id);
        const x = tileCenter(player.tilePos.x, this.mapData.tileSize);
        const y = tileCenter(player.tilePos.y, this.mapData.tileSize);
        const sheetKey = playerSheetKey(player.spriteId);
        ensureWalkAnims(this, sheetKey);
        let actor = this.remotes.get(player.id);
        if (!actor || actor.sheetKey !== sheetKey) {
          actor?.container.destroy(true);
          const shadow = this.add.ellipse(0, 6, 10, 4, 0x172033, 0.24);
          const sprite = this.add.sprite(0, 8, sheetKey, idleFrame(player.facing || "down")).setOrigin(0.5, 1);
          const label = createNameTag(this, player.name, player.inBattle);
          const container = this.add.container(x, y, [shadow, sprite, label]).setDepth(actorDepth(player.tilePos.y));
          actor = {
            container,
            sprite,
            label,
            sheetKey,
            lastSeqPosition: `${player.tilePos.mapId}:${player.tilePos.x}:${player.tilePos.y}`,
            lastLabel: nameTagText(player.name, player.inBattle),
          };
          this.remotes.set(player.id, actor);
        } else {
          const nextLabel = nameTagText(player.name, player.inBattle);
          if (nextLabel !== actor.lastLabel) {
            actor.label.destroy(true);
            actor.label = createNameTag(this, player.name, player.inBattle);
            actor.container.add(actor.label);
            actor.lastLabel = nextLabel;
          }
        }

        const facing = player.facing || "down";
        if (player.moving) playWalk(actor.sprite, actor.sheetKey, facing);
        else stopWalk(actor.sprite, facing, actor.sheetKey);
        const positionKey = `${player.tilePos.mapId}:${player.tilePos.x}:${player.tilePos.y}`;
        actor.container.setDepth(actorDepth(player.tilePos.y));
        if (positionKey !== actor.lastSeqPosition) {
          this.tweens.killTweensOf(actor.container);
          this.tweens.add({ targets: actor.container, x, y, duration: STEP_MS, ease: "Linear" });
          actor.lastSeqPosition = positionKey;
        }
      });

    for (const [id, actor] of this.remotes) {
      if (active.has(id)) continue;
      actor.container.destroy(true);
      this.remotes.delete(id);
    }
  }

  private showStatus(message: string) {
    if (!this.statusText) {
      this.statusText = this.add
        .text(8, 26, "", {
          fontFamily: "monospace",
          fontSize: "8px",
          color: "#fff4cc",
          backgroundColor: "#24324acc",
          padding: { x: 4, y: 3 },
        })
        .setScrollFactor(0)
        .setDepth(101);
    }
    this.statusText.setText(message).setVisible(Boolean(message));
  }

  private tryInteract() {
    const front = facingTile(this.bridgeState.tilePos, this.facing);
    const npc = npcAt(this.mapData.id, front.x, front.y);
    if (npc) {
      this.callbacks.onNpcInteract?.(npc);
      return;
    }
    const other = this.bridgeState.nearbyPlayers.find(
      (p) => p.tilePos?.mapId === this.mapData.id && p.tilePos.x === front.x && p.tilePos.y === front.y
    );
    if (other) this.callbacks.onPlayerInteract?.(other.id);
  }

  private mergedControls(): ControlState {
    return {
      up: this.controls.up || this.pad.up,
      down: this.controls.down || this.pad.down,
      left: this.controls.left || this.pad.left,
      right: this.controls.right || this.pad.right,
    };
  }

  private justPressedInteract() {
    const queued = this.interactQueued;
    this.interactQueued = false;
    return Boolean(
      queued ||
        (this.interactKey && Phaser.Input.Keyboard.JustDown(this.interactKey)) ||
        (this.zKey && Phaser.Input.Keyboard.JustDown(this.zKey)) ||
        (this.enterKey && Phaser.Input.Keyboard.JustDown(this.enterKey)) ||
        (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey))
    );
  }

  update(_: number, delta: number) {
    if (!this.ready || !this.player) return;
    if (this.justPressedInteract()) this.tryInteract();

    this.stepCooldown = Math.max(0, this.stepCooldown - delta);
    if (this.stepCooldown > 0 || this.moving) return;
    const direction = getDirectionFromControls(this.mergedControls());
    if (!direction) {
      stopWalk(this.player, this.facing, this.playerSheetKey);
      if (!this.idleEmitted) {
        this.idleEmitted = true;
        this.callbacks.onUpdateTilePos?.(this.bridgeState.playerId, this.bridgeState.tilePos, this.facing, false);
      }
      return;
    }

    this.facing = direction;
    const dx = direction === "left" ? -1 : direction === "right" ? 1 : 0;
    const dy = direction === "up" ? -1 : direction === "down" ? 1 : 0;
    const current = this.bridgeState.tilePos;
    const nextX = current.x + dx;
    const nextY = current.y + dy;
    if (isBlockedTile(this.mapData, nextX, nextY, this.occupiedTiles())) {
      stopWalk(this.player, direction, this.playerSheetKey);
      this.stepCooldown = STEP_MS;
      if (this.mapData.id === "pallet_town" && nextY < 1 && direction === "up") {
        this.callbacks.onBlockedMessage?.("Route 1 is not open in this demo.");
      }
      return;
    }

    const nextTile: TilePosition = { mapId: this.mapData.id, x: nextX, y: nextY };
    this.bridgeState = { ...this.bridgeState, tilePos: nextTile };
    this.moving = true;
    this.idleEmitted = false;
    this.stepCooldown = STEP_MS;
    playWalk(this.player, this.playerSheetKey, direction);
    this.player.setDepth(actorDepth(nextY));
    this.playerShadow?.setDepth(actorDepth(nextY) - 1);
    this.callbacks.onUpdateTilePos?.(this.bridgeState.playerId, nextTile, this.facing, true);

    const targetX = tileCenter(nextX, this.mapData.tileSize);
    const targetY = tileCenter(nextY, this.mapData.tileSize);
    this.tweens.add({
      targets: this.player,
      x: targetX,
      y: targetY + 8,
      duration: STEP_MS,
      ease: "Linear",
    });
    this.tweens.add({
      targets: this.playerShadow,
      x: targetX,
      y: targetY + 6,
      duration: STEP_MS,
      ease: "Linear",
      onComplete: () => {
        this.moving = false;
        const warp = getWarpAt(this.mapData, nextX, nextY);
        if (warp) {
          this.callbacks.onTravel?.(warp.toLocation, {
            mapId: warp.toMapId,
            x: warp.toX,
            y: warp.toY,
          });
        }
      },
    });
  }
}
