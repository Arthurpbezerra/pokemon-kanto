import React, { useMemo, useEffect, useState } from "react";

export type LocationInfo = {
  type: "town" | "grass" | "water" | "cave";
  connections: string[];
  x: number;
  y: number;
  gym?: string | null;
};

const LOCATION_TYPE_STYLE: Record<string, { fill: string; stroke: string; r: number }> = {
  town: { fill: "#f59e0b", stroke: "#b45309", r: 4 },
  grass: { fill: "#22c55e", stroke: "#15803d", r: 3 },
  water: { fill: "#0ea5e9", stroke: "#0369a1", r: 3 },
  cave: { fill: "#78716c", stroke: "#57534e", r: 3.5 },
};

/** Grid layout: (col, row). North = small row, West = small col. Vertical spine (R1, R2, Viridian) left; R7/R8 central block, not overlapping R1. */
const GRID_COLS = 22;
const GRID_ROWS = 20;
const GRID_STEP = 10;
const PAD = 12;
const W = PAD * 2 + (GRID_COLS - 1) * GRID_STEP;
const H = PAD * 2 + (GRID_ROWS - 1) * GRID_STEP;

const GRID_POS: Record<string, { col: number; row: number }> = {
  "Indigo Plateau": { col: 10, row: 0 },
  "Viridian Gym": { col: 10, row: 2 },
  "Viridian City": { col: 10, row: 4 },
  "Route 1": { col: 10, row: 6 },
  "Pallet Town": { col: 10, row: 8 },
  "Route 2": { col: 11, row: 4 },
  "Viridian Forest": { col: 13, row: 3 },
  "Pewter City": { col: 14, row: 2 },
  "Mt. Moon": { col: 16, row: 2 },
  "Route 4": { col: 18, row: 2 },
  "Cerulean City": { col: 20, row: 2 },
  "Route 24": { col: 20, row: 4 },
  "Route 25": { col: 18, row: 4 },
  "Bill's Sea Cottage": { col: 16, row: 4 },
  "Route 5": { col: 18, row: 6 },
  "Saffron City": { col: 14, row: 6 },
  "Route 6": { col: 20, row: 6 },
  "Vermilion City": { col: 20, row: 8 },
  "Route 11": { col: 20, row: 10 },
  "Route 12": { col: 18, row: 10 },
  "Lavender Town": { col: 16, row: 10 },
  "Route 10": { col: 18, row: 8 },
  "Route 7": { col: 12, row: 8 },
  "Route 8": { col: 14, row: 8 },
  "Celadon City": { col: 10, row: 10 },
  "Route 9": { col: 12, row: 9 },
  "Route 16": { col: 10, row: 12 },
  "Route 17": { col: 10, row: 14 },
  "Route 18": { col: 12, row: 14 },
  "Fuchsia City": { col: 14, row: 14 },
  "Route 19": { col: 12, row: 16 },
  "Route 20": { col: 8, row: 16 },
  "Cinnabar Island": { col: 4, row: 16 },
  "Route 21": { col: 4, row: 12 },
  "Route 13": { col: 14, row: 12 },
  "Route 14": { col: 14, row: 10 },
  "Route 15": { col: 16, row: 10 },
};

function gridToSvg(col: number, row: number) {
  return {
    x: PAD + col * GRID_STEP,
    y: PAD + row * GRID_STEP,
  };
}

function getGridPos(name: string, loc: LocationInfo): { col: number; row: number } {
  const pos = GRID_POS[name];
  if (pos) return pos;
  return {
    col: Math.round((loc.x / 100) * (GRID_COLS - 1)),
    row: Math.round((loc.y / 100) * (GRID_ROWS - 1)),
  };
}

export type OtherPlayer = { name: string; color: string; location: string };

const PLAYER_COLORS: Record<string, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  green: "#22c55e",
  yellow: "#eab308",
};

function resolvePlayerFill(color?: string): string {
  if (!color) return "#94a3b8";
  if (color.startsWith("#")) return color;
  return PLAYER_COLORS[color] ?? "#94a3b8";
}

export default function KantoMapView({
  locations,
  currentLocation,
  otherPlayers = [],
  onClose,
}: {
  locations: Record<string, LocationInfo>;
  currentLocation: string;
  otherPlayers?: OtherPlayer[];
  onClose: () => void;
}) {
  const entries = useMemo(() => Object.entries(locations), [locations]);

  const nodePositions = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    entries.forEach(([name, loc]) => {
      const { col, row } = getGridPos(name, loc);
      out[name] = gridToSvg(col, row);
    });
    return out;
  }, [entries, locations]);

  const roads = useMemo(() => {
    const drawn = new Set<string>();
    const out: { points: string }[] = [];
    entries.forEach(([name, loc]) => {
      const from = nodePositions[name];
      if (!from) return;
      (loc.connections || []).forEach((conn) => {
        const other = nodePositions[conn];
        if (!other) return;
        const key = [name, conn].sort().join("--");
        if (drawn.has(key)) return;
        drawn.add(key);
        const { x: x1, y: y1 } = from;
        const { x: x2, y: y2 } = other;
        if (x1 === x2 && y1 === y2) return;
        const points = `${x1},${y1} ${x2},${y1} ${x2},${y2}`;
        out.push({ points });
      });
    });
    return out;
  }, [entries, nodePositions]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const currentPos = nodePositions[currentLocation];
  const [tokenPos, setTokenPos] = useState<{ x: number; y: number } | null>(currentPos ?? null);

  useEffect(() => {
    setTokenPos(currentPos ?? null);
  }, [currentPos?.x, currentPos?.y]);

  const displayPos = tokenPos ?? currentPos;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-gray-900/95 modal-backdrop overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Kanto map"
    >
      <header className="flex items-center justify-between p-3 sm:p-4 border-b border-amber-600/50 bg-gray-900/90 shrink-0" onClick={(e) => e.stopPropagation()}>
        <h2 className="section-title text-sm sm:text-base mb-0">Kanto Map</h2>
        <button type="button" className="pixel-btn text-xs" onClick={onClose} aria-label="Close map">
          Close
        </button>
      </header>
      <div
        className="flex-1 min-h-0 p-3 sm:p-4 flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-2xl aspect-square max-h-[min(78vh,78vw)] bg-amber-950/60 rounded-gameLg border-2 border-amber-700/50 overflow-hidden shadow-panel flex items-center justify-center">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-full min-w-0 min-h-0"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <filter id="kanto-map-glow">
                <feGaussianBlur stdDeviation="1.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="kanto-map-sea" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0c4a6e" />
                <stop offset="100%" stopColor="#082f49" />
              </linearGradient>
            </defs>
            <rect width={W} height={H} fill="url(#kanto-map-sea)" />
            <rect x={PAD} y={PAD} width={W - PAD * 2} height={H - PAD * 2} rx={6} fill="#1c1917" stroke="#44403c" strokeWidth="1" />

            {/* Streets: perpendicular segments (horizontal then vertical) */}
            {roads.map((road, i) => (
              <polyline
                key={`road-${i}`}
                points={road.points}
                fill="none"
                stroke="#57534e"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}

            {/* Location nodes */}
            {entries.map(([name, loc]) => {
              const pos = nodePositions[name];
              if (!pos) return null;
              const { x, y } = pos;
              const style = LOCATION_TYPE_STYLE[loc.type] ?? LOCATION_TYPE_STYLE.town;
              const isCurrent = name === currentLocation;
              const r = style.r + (isCurrent ? 1.2 : 0);
              const label = name.startsWith("Route ") ? `R ${name.slice(6)}` : (name.length > 14 ? name.slice(0, 12) + "…" : name);
              return (
                <g key={name}>
                  <circle
                    cx={x}
                    cy={y}
                    r={r}
                    fill={style.fill}
                    stroke={isCurrent ? "#fbbf24" : style.stroke}
                    strokeWidth={isCurrent ? 2 : 1}
                  />
                  <text
                    x={x}
                    y={y + r + 3.5}
                    textAnchor="middle"
                    fill={isCurrent ? "#fde047" : "#e7e5e4"}
                    fontSize={isCurrent ? 3.5 : 2.8}
                    fontWeight={isCurrent ? "bold" : "normal"}
                  >
                    {label}
                  </text>
                </g>
              );
            })}

            {/* Other players */}
            {otherPlayers.map((op, idx) => {
              const pos = nodePositions[op.location];
              if (!pos) return null;
              const offset = (idx + 1) * 3;
              const fill = resolvePlayerFill(op.color);
              return (
                <g key={`other-${op.name}-${idx}`}>
                  <circle cx={pos.x + offset} cy={pos.y - 2} r={2.2} fill={fill} stroke="#1c1917" strokeWidth={0.6} opacity={0.85} />
                  <text x={pos.x + offset} y={pos.y - 5} textAnchor="middle" fill={fill} fontSize={2.2} fontWeight="bold" opacity={0.9}>{op.name}</text>
                </g>
              );
            })}

            {/* Player token (GPU-friendly transform transition) */}
            {displayPos && (
              <g
                className="kanto-map-player-token"
                style={{
                  transform: `translate(${displayPos.x}px, ${displayPos.y}px)`,
                  transition: "transform 400ms ease-out",
                  animation: "kanto-token-pulse 1.5s ease-in-out infinite",
                  willChange: "transform"
                }}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={3.5}
                  fill="#fef3c7"
                  stroke="#f59e0b"
                  strokeWidth={1.2}
                />
                <circle cx={0} cy={0} r={2} fill="#fbbf24" opacity={0.9} />
              </g>
            )}
          </svg>
        </div>
        <p className="mt-3 text-xs sm:text-sm text-amber-200/90">
          You are here: <strong className="text-amber-300">{currentLocation.startsWith("Route ") ? `R ${currentLocation.slice(6)}` : currentLocation}</strong>
        </p>
      </div>
    </div>
  );
}
