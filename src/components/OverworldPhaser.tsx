import React, { useEffect, useRef } from "react";
import * as Phaser from "phaser";
import {
  OverworldScene,
  type PhaserBridgeCallbacks,
  type PhaserBridgeState,
} from "../game/phaser/scenes/OverworldScene";
import { GBA_VIEW_H, GBA_VIEW_W } from "../game/phaser/gbaViewport";
import type { MapNpc } from "../world/palletMaps";
import { DEFAULT_SPAWN } from "../world/palletMaps";
import type { Direction, TilePosition } from "../world/tileWorld";

type NearbyPlayer = {
  id: string;
  name: string;
  color: string;
  tilePos?: TilePosition;
  spriteId?: string;
  facing?: Direction;
  moving?: boolean;
  inBattle?: boolean;
};

export type OverworldPhaserHandle = {
  setPadDirection: (dir: Direction | null) => void;
  queueInteract: () => void;
  padCancel: () => void;
};

type Props = {
  playerId: string;
  currentLocation: string;
  currentTilePos?: TilePosition;
  currentSpriteId?: string;
  currentPlayerColor?: string;
  locationType: "town" | "grass" | "water" | "cave";
  canEncounter: boolean;
  nearbyPlayers?: NearbyPlayer[];
  /** Bare canvas only (inside GBA SP shell on mobile). */
  bare?: boolean;
  onControlsReady?: (handle: OverworldPhaserHandle) => void;
  onTravel: (to: string, spawnTile: TilePosition, fromTile: TilePosition) => void;
  onSearchWild?: () => void;
  onStayHere?: () => void;
  onUpdateTilePos?: (playerId: string, next: TilePosition, facing: Direction, moving: boolean) => void;
  onSpriteChange?: (spriteId: string) => void;
  onNpcInteract?: (npc: MapNpc) => void;
  onPlayerInteract?: (playerId: string) => void;
  onBlockedMessage?: (message: string) => void;
  onPadCancel?: () => void;
};

export default function OverworldPhaser({
  playerId,
  currentLocation,
  currentTilePos,
  currentSpriteId,
  currentPlayerColor,
  canEncounter,
  nearbyPlayers = [],
  bare = false,
  onControlsReady,
  onTravel,
  onSearchWild,
  onStayHere,
  onUpdateTilePos,
  onNpcInteract,
  onPlayerInteract,
  onBlockedMessage,
  onPadCancel,
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<OverworldScene | null>(null);
  const callbacksRef = useRef<PhaserBridgeCallbacks>({});
  callbacksRef.current = {
    onTravel,
    onSearchWild,
    onStayHere,
    onUpdateTilePos,
    onNpcInteract,
    onPlayerInteract,
    onBlockedMessage,
  };

  const padCancelRef = useRef(onPadCancel);
  padCancelRef.current = onPadCancel;

  useEffect(() => {
    onControlsReady?.({
      setPadDirection: (dir) => sceneRef.current?.setPadDirection(dir),
      queueInteract: () => sceneRef.current?.queueInteract(),
      padCancel: () => padCancelRef.current?.(),
    });
  }, [onControlsReady]);

  useEffect(() => {
    if (!rootRef.current || gameRef.current) return;
    const initialPos: TilePosition = currentTilePos ?? DEFAULT_SPAWN;
    const state: PhaserBridgeState = {
      playerId,
      playerColor: currentPlayerColor,
      tilePos: initialPos,
      spriteId: currentSpriteId,
      canEncounter,
      nearbyPlayers: [],
    };
    const callbacks: PhaserBridgeCallbacks = {
      onTravel: (...args) => callbacksRef.current.onTravel?.(...args),
      onSearchWild: () => callbacksRef.current.onSearchWild?.(),
      onStayHere: () => callbacksRef.current.onStayHere?.(),
      onUpdateTilePos: (...args) => callbacksRef.current.onUpdateTilePos?.(...args),
      onNpcInteract: (...args) => callbacksRef.current.onNpcInteract?.(...args),
      onPlayerInteract: (...args) => callbacksRef.current.onPlayerInteract?.(...args),
      onBlockedMessage: (...args) => callbacksRef.current.onBlockedMessage?.(...args),
    };
    const scene = new OverworldScene(state, callbacks);
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: rootRef.current,
      width: GBA_VIEW_W,
      height: GBA_VIEW_H,
      backgroundColor: "#0b1024",
      scene,
      render: {
        pixelArt: true,
        antialias: false,
        roundPixels: true,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: GBA_VIEW_W,
        height: GBA_VIEW_H,
      },
    });
    gameRef.current = game;
    return () => {
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = rootRef.current;
    const game = gameRef.current;
    if (!el || !game) return;

    const refresh = () => {
      game.scale.refresh();
    };

    const ro = new ResizeObserver(() => refresh());
    ro.observe(el);
    refresh();

    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;
    const nextPos: TilePosition = currentTilePos ?? DEFAULT_SPAWN;
    sceneRef.current.syncBridgeState({
      playerId,
      playerColor: currentPlayerColor,
      tilePos: nextPos,
      spriteId: currentSpriteId,
      canEncounter,
      nearbyPlayers: [],
    });
  }, [
    playerId,
    currentPlayerColor,
    currentTilePos?.mapId,
    currentSpriteId,
    canEncounter,
    currentLocation,
  ]);

  useEffect(() => {
    sceneRef.current?.syncNearbyPlayers(nearbyPlayers);
  }, [nearbyPlayers]);

  const canvas = <div className="gba-screen-canvas" ref={rootRef} />;

  if (bare) {
    return <div className="gba-screen-body gba-screen-body--game gba-screen-body--bare">{canvas}</div>;
  }

  return (
    <div className="gba-screen-panel gba-screen-panel--game">
      <div className="gba-screen-header">
        <span className="gba-screen-title">{currentLocation}</span>
        <span className="gba-screen-hint hidden lg:inline">WASD · E/Z talk</span>
      </div>
      <div className="gba-screen-body gba-screen-body--game">{canvas}</div>
    </div>
  );
}
