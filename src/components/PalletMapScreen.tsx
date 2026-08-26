import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MapNpc } from "../world/palletMaps";
import { canInteractPlayers } from "../world/palletMaps";
import { getMapById, type Direction, type TilePosition } from "../world/tileWorld";
import GbaSpShell from "./GbaSpShell";
import { useMobileSpLayout } from "../hooks/useMobileSpLayout";
import RoomChat, { type RoomChatMessage } from "./RoomChat";
import type { OverworldPhaserHandle } from "./OverworldPhaser";

const OverworldPhaser = React.lazy(() => import("./OverworldPhaser"));

type PlayerLike = {
  id: string;
  name: string;
  color: string;
  location: string;
  tilePos?: TilePosition;
  spriteId?: string;
  facing?: Direction;
  moving?: boolean;
  team: { id: number; name: string; sprite: string; level: number; hp: number; maxHp: number }[];
};

type PvpBattleLike = {
  challengerId: string;
  defenderId: string;
} | null;

type Props = {
  players: PlayerLike[];
  currentPlayerIndex: number;
  movePlayer: (playerId: string, to: string, options?: { skipEntryEncounter?: boolean; spawnTile?: TilePosition; skipTownUi?: boolean; fromTile?: TilePosition }) => void;
  setPlayerTilePos: (playerId: string, next: TilePosition, facing: Direction, moving: boolean) => void;
  setPlayerSprite: (playerId: string, spriteId: string) => void;
  healPlayer: (playerId: string) => void;
  isMultiplayer?: boolean;
  myPlayerId?: string | null;
  requestPvpBattle?: (from: string, to: string) => void;
  requestPvpTrade?: (from: string, to: string) => void;
  pvpBattle?: PvpBattleLike;
  roomChatMessages?: RoomChatMessage[];
  onSendRoomChat?: (text: string) => void;
  roomCode?: string;
  onOpenMenu?: () => void;
  onOpenTeam?: () => void;
  onOpenKantoMap?: () => void;
  canEncounter?: boolean;
  searchWild?: (playerId: string) => void;
};

export default function PalletMapScreen({
  players,
  currentPlayerIndex,
  movePlayer,
  setPlayerTilePos,
  setPlayerSprite,
  healPlayer,
  isMultiplayer,
  myPlayerId,
  requestPvpBattle,
  requestPvpTrade,
  pvpBattle,
  roomChatMessages = [],
  onSendRoomChat,
  roomCode,
  onOpenMenu,
  onOpenTeam,
  onOpenKantoMap,
  canEncounter = false,
  searchWild,
}: Props) {
  const current = players[currentPlayerIndex];
  const currentMap = current.tilePos?.mapId ? getMapById(current.tilePos.mapId) : getMapById("pallet_town");
  const [dialog, setDialog] = useState<{
    title: string;
    text: string;
    heal?: boolean;
    warpTo?: MapNpc["warpTo"];
  } | null>(null);
  const [interactId, setInteractId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
  const phaserHandleRef = useRef<OverworldPhaserHandle | null>(null);
  const isMobileSp = useMobileSpLayout();

  const sameMapPlayers = useMemo(
    () => players.filter((p) => p.id !== myPlayerId && p.tilePos?.mapId && p.tilePos.mapId === current.tilePos?.mapId),
    [players, myPlayerId, current.tilePos?.mapId]
  );
  const nearbyPlayers = useMemo(
    () =>
      sameMapPlayers.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        tilePos: p.tilePos,
        spriteId: p.spriteId,
        facing: p.facing,
        moving: p.moving,
        inBattle: Boolean(pvpBattle && (p.id === pvpBattle.challengerId || p.id === pvpBattle.defenderId)),
      })),
    [sameMapPlayers, pvpBattle]
  );
  const adjacentPlayers = sameMapPlayers.filter((p) => canInteractPlayers(current, p) || canInteractPlayers(p, current));

  const movingRef = React.useRef(current.moving);
  movingRef.current = current.moving;

  useEffect(() => {
    if (!isMultiplayer || !current.tilePos) return;
    const t = window.setInterval(() => {
      if (!current.tilePos || movingRef.current) return;
      setPlayerTilePos(current.id, current.tilePos, current.facing ?? "down", false);
    }, 2000);
    return () => window.clearInterval(t);
  }, [isMultiplayer, current.id, current.tilePos?.mapId, current.tilePos?.x, current.tilePos?.y, current.facing]);

  const interactTarget = interactId ? players.find((p) => p.id === interactId) : null;
  const chatDisabled = !onSendRoomChat || !roomCode;

  const padCancel = () => {
    setDialog(null);
    setInteractId(null);
    setMobileChatOpen(false);
  };

  const confirmNpcWarp = (warp: NonNullable<MapNpc["warpTo"]>) => {
    const fromTile = current.tilePos ?? { mapId: "pallet_town", x: 6, y: 8 };
    movePlayer(current.id, warp.toLocation, {
      skipEntryEncounter: true,
      spawnTile: { mapId: warp.toMapId, x: warp.toX, y: warp.toY },
      fromTile,
      skipTownUi: true,
    });
    setDialog(null);
  };

  const npcDialogActions = dialog && (
    <div className="flex gap-2 flex-wrap">
      {dialog.warpTo && (
        <button className="pixel-btn pixel-btn-primary flex-1" onClick={() => confirmNpcWarp(dialog.warpTo!)}>
          Travel
        </button>
      )}
      {dialog.heal && (
        <button
          className="pixel-btn pixel-btn-primary flex-1"
          onClick={() => {
            healPlayer(current.id);
            setDialog({ title: dialog.title, text: "Your Pokémon were fully healed!" });
          }}
        >
          Heal party
        </button>
      )}
      <button className="pixel-btn flex-1" onClick={() => setDialog(null)}>
        {dialog.warpTo ? "Cancel" : "Close"}
      </button>
    </div>
  );

  const onControlsReady = useCallback((handle: OverworldPhaserHandle) => {
    phaserHandleRef.current = handle;
  }, []);

  const phaserProps = {
    playerId: current.id,
    currentLocation: current.location,
    currentTilePos: current.tilePos,
    currentSpriteId: current.spriteId,
    currentPlayerColor: current.color,
    locationType: "town" as const,
    canEncounter,
    onSearchWild: () => searchWild?.(current.id),
    nearbyPlayers,
    bare: true,
    onTravel: (to: string, spawnTile: TilePosition, fromTile: TilePosition) =>
      movePlayer(current.id, to, {
        skipEntryEncounter: true,
        spawnTile,
        fromTile,
        skipTownUi: true,
      }),
    onUpdateTilePos: (playerId: string, next: TilePosition, facing: Direction, moving: boolean) => {
      setPlayerTilePos(playerId, next, facing, moving);
    },
    onSpriteChange: (spriteId: string) => setPlayerSprite(current.id, spriteId),
    onNpcInteract: (npc: MapNpc) => {
      if (npc.warpTo) {
        setDialog({ title: npc.name, text: npc.text, warpTo: npc.warpTo });
        return;
      }
      setDialog({ title: npc.name, text: npc.text, heal: npc.heal });
    },
    onPlayerInteract: (id: string) => setInteractId(id),
    onBlockedMessage: (msg: string) => {
      setNotice(msg);
      window.setTimeout(() => setNotice(null), 2500);
    },
    onPadCancel: padCancel,
    onControlsReady,
  };

  const controls = () => phaserHandleRef.current;

  const phaserFallback = <div className="gba-screen-body gba-screen-body--game p-3 text-xs text-gray-300">Loading map…</div>;

  const openChat = () => setMobileChatOpen(true);
  const padDebug = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("padDebug");

  if (isMobileSp) {
    return (
      <div className="pallet-map-mobile-root">
        <GbaSpShell
          locationLabel={current.location}
          padDebug={padDebug}
          onOpenChat={openChat}
          chatPeek={
            !mobileChatOpen && roomChatMessages.length > 0 ? (
              <RoomChat
                variant="peek"
                messages={roomChatMessages}
                onSend={() => {}}
                onOpen={openChat}
                myPlayerId={myPlayerId}
              />
            ) : null
          }
          onDirection={(dir) => controls()?.setPadDirection(dir)}
          onDirectionTap={(dir) => controls()?.queuePadStep(dir)}
          onA={() => controls()?.queueInteract()}
          onB={() => controls()?.padCancel()}
          onStart={onOpenMenu}
          onSelect={openChat}
          onL={onOpenTeam}
          onR={onOpenKantoMap}
          onMenu={onOpenMenu}
        >
          <Suspense fallback={phaserFallback}>
            <OverworldPhaser {...phaserProps} />
          </Suspense>
        </GbaSpShell>

        <RoomChat
          variant="sheet"
          open={mobileChatOpen}
          onClose={() => setMobileChatOpen(false)}
          messages={roomChatMessages}
          onSend={(text) => onSendRoomChat?.(text)}
          disabled={chatDisabled}
          disabledHint="Join a room to chat"
          myPlayerId={myPlayerId}
        />

        {dialog && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3">
            <div className="card-panel w-full max-w-md p-4 text-white">
              <div className="font-bold text-yellow-300 mb-2">{dialog.title}</div>
              <p className="text-sm text-gray-200 mb-3">{dialog.text}</p>
              {npcDialogActions}
            </div>
          </div>
        )}

        {interactTarget && (
          <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 p-3">
            <div className="card-panel w-full max-w-sm p-4 text-white">
              <div className="font-bold text-yellow-300 mb-3">{interactTarget.name}</div>
              <button className="pixel-btn w-full mb-2" onClick={() => { setInteractId(null); setDialog({ title: interactTarget.name, text: `${interactTarget.name} is exploring Pallet Town.` }); }}>Talk</button>
              <button className="pixel-btn w-full mb-2" onClick={() => { requestPvpBattle?.(myPlayerId!, interactTarget.id); setInteractId(null); }}>Challenge</button>
              <button className="pixel-btn w-full mb-2" onClick={() => { requestPvpTrade?.(myPlayerId!, interactTarget.id); setInteractId(null); }}>Trade</button>
              <button className="pixel-btn w-full" onClick={() => setInteractId(null)}>Back</button>
            </div>
          </div>
        )}

        {notice && (
          <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[55] card-panel px-3 py-2 text-xs text-yellow-200">{notice}</div>
        )}
      </div>
    );
  }

  return (
    <div className="pallet-map-desktop flex flex-col lg:flex-row gap-4 w-full max-w-full">
      <div className="pallet-play-column min-w-0 flex-1 space-y-4">
        <div className="pallet-play-row">
          <div className="gba-screen-panel gba-screen-panel--game pallet-game-panel">
            <div className="gba-screen-header">
              <span className="gba-screen-title">{current.location}</span>
              <span className="gba-screen-hint">WASD · E/Z talk</span>
            </div>
            <Suspense fallback={phaserFallback}>
              <OverworldPhaser {...phaserProps} />
            </Suspense>
          </div>
          <RoomChat
            variant="sidebar"
            messages={roomChatMessages}
            onSend={(text) => onSendRoomChat?.(text)}
            disabled={chatDisabled}
            disabledHint="Join a room to chat"
            myPlayerId={myPlayerId}
          />
        </div>

        {adjacentPlayers.length > 0 && (
          <div className="p-3 bg-gray-800 rounded-lg border border-gray-600/50">
            <div className="text-xs sm:text-sm font-bold text-yellow-300 mb-2">Facing a trainer</div>
            {adjacentPlayers.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs sm:text-sm truncate">{p.name}</span>
                <div className="flex gap-2">
                  <button className="pixel-btn text-[10px] sm:text-xs" onClick={() => requestPvpBattle?.(myPlayerId!, p.id)}>Battle</button>
                  <button className="pixel-btn text-[10px] sm:text-xs" onClick={() => requestPvpTrade?.(myPlayerId!, p.id)}>Trade</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <aside className="w-full lg:w-72 p-3 card-panel min-w-0 border border-gray-700/50 lg:sticky lg:top-3 self-start shrink-0">
        <div className="text-xs sm:text-sm text-gray-400 mb-1">Playing as</div>
        <div className="text-sm sm:text-base font-bold text-yellow-300 truncate mb-2">{current.name}</div>
        <div className="text-[10px] sm:text-xs text-gray-500 mb-3 truncate">
          {current.location} · {currentMap.id} ({current.tilePos?.x},{current.tilePos?.y})
        </div>
        {isMultiplayer && (
          <div className="mb-3">
            <div className="text-xs font-bold text-gray-300 mb-1">In this room</div>
            <ul className="text-[10px] sm:text-xs text-gray-400 space-y-0.5">
              {players.map((p) => (
                <li key={p.id} className="truncate">
                  {p.id === myPlayerId ? "★ " : ""}
                  {p.name}
                  {p.tilePos ? ` · ${p.tilePos.mapId} (${p.tilePos.x},${p.tilePos.y})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="text-xs sm:text-sm font-bold text-gray-300 mb-2">Team</div>
        <div className="space-y-2">
          {current.team.map((pk, idx) => {
            const pct = Math.max(0, (pk.hp / (pk.maxHp || 1)) * 100);
            const hpCol = pct > 60 ? "bg-green-500" : pct > 30 ? "bg-yellow-500" : "bg-red-500";
            return (
              <div key={`${pk.id}-${idx}`} className={`flex items-center gap-2 bg-gray-700/80 p-2 rounded-lg min-w-0 border ${idx === 0 ? "border-amber-500/50" : "border-transparent"}`}>
                <img src={pk.sprite} className="w-10 h-10 flex-shrink-0 rounded-lg bg-gray-800" alt={pk.name} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs truncate">{idx === 0 && "★ "}{pk.name} Lv{pk.level}</div>
                  <div className="h-1.5 hp-bar bg-gray-800 rounded w-full mt-1 max-w-[100px]">
                    <div className={`hp-bar-fill h-1.5 ${hpCol} rounded`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="text-[10px] text-gray-400">{pk.hp}/{pk.maxHp}</div>
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      {dialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
          <div className="card-panel w-full max-w-md p-4 text-white">
            <div className="font-bold text-yellow-300 mb-2">{dialog.title}</div>
            <p className="text-sm text-gray-200 mb-3">{dialog.text}</p>
            {npcDialogActions}
          </div>
        </div>
      )}

      {interactTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3">
          <div className="card-panel w-full max-w-sm p-4 text-white">
            <div className="font-bold text-yellow-300 mb-3">{interactTarget.name}</div>
            <button className="pixel-btn w-full mb-2" onClick={() => { setInteractId(null); setDialog({ title: interactTarget.name, text: `${interactTarget.name} is exploring Pallet Town.` }); }}>Talk</button>
            <button className="pixel-btn w-full mb-2" onClick={() => { requestPvpBattle?.(myPlayerId!, interactTarget.id); setInteractId(null); }}>Challenge</button>
            <button className="pixel-btn w-full mb-2" onClick={() => { requestPvpTrade?.(myPlayerId!, interactTarget.id); setInteractId(null); }}>Trade</button>
            <button className="pixel-btn w-full" onClick={() => setInteractId(null)}>Back</button>
          </div>
        </div>
      )}

      {notice && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40 card-panel px-3 py-2 text-xs text-yellow-200">{notice}</div>
      )}
    </div>
  );
}
