import React, { useEffect, useRef, useState } from "react";
import * as Phaser from "phaser";
import {
  OverworldScene,
  type PhaserBridgeCallbacks,
  type PhaserBridgeState,
} from "../game/phaser/scenes/OverworldScene";
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

type Props = {
  playerId: string;
  currentLocation: string;
  currentTilePos?: TilePosition;
  currentSpriteId?: string;
  currentPlayerColor?: string;
  locationType: "town" | "grass" | "water" | "cave";
  canEncounter: boolean;
  nearbyPlayers?: NearbyPlayer[];
  onTravel: (to: string, spawnTile?: TilePosition) => void;
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
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.floor(r.width), h: Math.floor(r.height) });
    };
    update();
    const ro = new ResizeObserver(() => update());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canInit = size.w >= 240 && size.h >= 240;

  useEffect(() => {
    if (!rootRef.current || gameRef.current || !canInit) return;
    const initialPos: TilePosition = currentTilePos ?? DEFAULT_SPAWN;
    const state: PhaserBridgeState = {
      playerId,
      playerColor: currentPlayerColor,
      tilePos: initialPos,
      spriteId: currentSpriteId,
      canEncounter,
      nearbyPlayers,
    };
    const callbacks: PhaserBridgeCallbacks = {
      onTravel,
      onSearchWild,
      onStayHere,
      onUpdateTilePos,
      onNpcInteract,
      onPlayerInteract,
      onBlockedMessage,
    };
    const scene = new OverworldScene(state, callbacks);
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: rootRef.current,
      scene,
      physics: {
        default: "arcade",
        arcade: { debug: false },
      },
      width: Math.max(320, size.w) || 860,
      height: Math.max(320, size.h) || 560,
      backgroundColor: "#0b1024",
      render: {
        pixelArt: true,
        antialias: false,
        roundPixels: true,
      },
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: "100%",
        height: "100%",
      },
    });
    gameRef.current = game;
    return () => {
      sceneRef.current = null;
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, [canInit, size.w, size.h]);

  useEffect(() => {
    if (!sceneRef.current) return;
    const nextPos: TilePosition = currentTilePos ?? DEFAULT_SPAWN;
    sceneRef.current.syncBridgeState({
      playerId,
      playerColor: currentPlayerColor,
      tilePos: nextPos,
      spriteId: currentSpriteId,
      canEncounter,
      nearbyPlayers,
    });
  }, [
    playerId,
    currentPlayerColor,
    currentTilePos?.mapId,
    currentTilePos?.x,
    currentTilePos?.y,
    currentSpriteId,
    canEncounter,
    nearbyPlayers,
    currentLocation,
  ]);

  return (
    <div className="card-panel p-2 sm:p-3 border border-amber-500/40 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs sm:text-sm text-amber-300 font-bold">Pallet Town</div>
        <div className="text-[10px] sm:text-xs text-gray-300 hidden sm:block">WASD / Arrows · E/Z interact</div>
        <div className="text-[10px] text-gray-300 sm:hidden">D-pad + A talk · B back</div>
      </div>
      <div className="phaser-world-wrap">
        <div className="phaser-world-shell" ref={rootRef}>
          {!canInit && (
            <div className="p-3 text-xs text-gray-300">
              Preparing Phaser viewport… ({size.w}×{size.h})
            </div>
          )}
        </div>
        <GbaPad
          onDirection={(dir) => sceneRef.current?.setPadDirection(dir)}
          onA={() => sceneRef.current?.queueInteract()}
          onB={() => onPadCancel?.()}
        />
      </div>
    </div>
  );
}

function dirFromPoint(el: HTMLElement, clientX: number, clientY: number): Direction | null {
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  if (dx * dx + dy * dy < 280) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function GbaPad({
  onDirection,
  onA,
  onB,
}: {
  onDirection: (dir: Direction | null) => void;
  onA: () => void;
  onB: () => void;
}) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    const stop = () => {
      if (!holding.current) return;
      holding.current = false;
      onDirection(null);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onDirection]);

  return (
    <div className="gba-pad" aria-hidden={false}>
      <div
        ref={padRef}
        className="gba-dpad"
        role="group"
        aria-label="D-pad"
        onPointerDown={(e) => {
          e.preventDefault();
          holding.current = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          onDirection(dirFromPoint(e.currentTarget, e.clientX, e.clientY));
        }}
        onPointerMove={(e) => {
          if (!holding.current) return;
          onDirection(dirFromPoint(e.currentTarget, e.clientX, e.clientY));
        }}
      >
        <span className="gba-dpad-n">▲</span>
        <span className="gba-dpad-w">◀</span>
        <span className="gba-dpad-e">▶</span>
        <span className="gba-dpad-s">▼</span>
        <span className="gba-dpad-c" />
      </div>
      <div className="gba-face">
        <button
          type="button"
          className="gba-btn gba-btn-b"
          aria-label="B, back"
          onPointerDown={(e) => {
            e.preventDefault();
            onB();
          }}
        >
          B
        </button>
        <button
          type="button"
          className="gba-btn gba-btn-a"
          aria-label="A, talk"
          onPointerDown={(e) => {
            e.preventDefault();
            onA();
          }}
        >
          A
        </button>
      </div>
    </div>
  );
}
