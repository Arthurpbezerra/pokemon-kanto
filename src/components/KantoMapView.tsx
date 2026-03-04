import React from "react";

export type LocationInfo = {
  type: "town" | "grass" | "water" | "cave";
  connections: string[];
  x: number;
  y: number;
  gym?: string | null;
};

const LOCATION_TYPE_STYLE: Record<string, { fill: string; stroke: string; r: number }> = {
  town: { fill: "#f59e0b", stroke: "#b45309", r: 4.5 },
  grass: { fill: "#22c55e", stroke: "#15803d", r: 3.2 },
  water: { fill: "#0ea5e9", stroke: "#0369a1", r: 3.2 },
  cave: { fill: "#78716c", stroke: "#57534e", r: 3.5 },
};

export default function KantoMapView({
  locations,
  currentLocation,
  onClose,
}: {
  locations: Record<string, LocationInfo>;
  currentLocation: string;
  onClose: () => void;
}) {
  const entries = Object.entries(locations);
  const scale = 100;
  const pad = 4;
  const w = scale + pad * 2;
  const h = scale + pad * 2;
  const toSvg = (x: number, y: number) => ({ x: pad + (x / 100) * scale, y: pad + (y / 100) * scale });

  const drawn = new Set<string>();
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  entries.forEach(([name, loc]) => {
    const from = toSvg(loc.x, loc.y);
    (loc.connections || []).forEach((conn) => {
      const other = locations[conn];
      if (!other) return;
      const key = [name, conn].sort().join("--");
      if (drawn.has(key)) return;
      drawn.add(key);
      const to = toSvg(other.x, other.y);
      lines.push({ x1: from.x, y1: from.y, x2: to.x, y2: to.y });
    });
  });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/95 modal-backdrop" onClick={onClose}>
      <div className="flex items-center justify-between p-2 sm:p-3 border-b border-amber-600/50 bg-gray-900/90 shrink-0" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm sm:text-base font-bold text-amber-300">Kanto Map</h2>
        <button type="button" className="pixel-btn text-xs" onClick={onClose}>Close</button>
      </div>
      <div className="flex-1 min-h-0 p-2 sm:p-4 flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
        <div className="w-full max-w-2xl aspect-square max-h-[min(80vh,80vw)] bg-amber-950/60 rounded-xl border-2 border-amber-700/50 overflow-hidden shadow-inner">
          <svg
            viewBox={`0 0 ${w} ${h}`}
            className="w-full h-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <filter id="glow">
                <feGaussianBlur stdDeviation="0.8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="sea" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor="#0c4a6e" />
                <stop offset="100%" stopColor="#082f49" />
              </linearGradient>
            </defs>
            <rect width={w} height={h} fill="url(#sea)" />
            <rect x={pad} y={pad} width={scale} height={scale} rx={2} fill="#1c1917" stroke="#44403c" strokeWidth="0.5" />

            {/* Route lines */}
            {lines.map((line, i) => (
              <line
                key={i}
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke="#78716c"
                strokeWidth="0.8"
                strokeLinecap="round"
              />
            ))}

            {/* Location nodes */}
            {entries.map(([name, loc]) => {
              const { x, y } = toSvg(loc.x, loc.y);
              const style = LOCATION_TYPE_STYLE[loc.type] ?? LOCATION_TYPE_STYLE.town;
              const isCurrent = name === currentLocation;
              return (
                <g key={name}>
                  <circle
                    cx={x}
                    cy={y}
                    r={style.r + (isCurrent ? 1.2 : 0)}
                    fill={style.fill}
                    stroke={isCurrent ? "#fbbf24" : style.stroke}
                    strokeWidth={isCurrent ? 1.4 : 0.6}
                    filter={isCurrent ? "url(#glow)" : undefined}
                  />
                  <text
                    x={x}
                    y={y + style.r + 2.8}
                    textAnchor="middle"
                    fill={isCurrent ? "#fde047" : "#e7e5e4"}
                    fontSize={isCurrent ? 2.2 : 1.8}
                    fontWeight={isCurrent ? "bold" : "normal"}
                  >
                    {name.length > 12 ? name.slice(0, 10) + "…" : name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
        <p className="mt-2 text-xs sm:text-sm text-amber-200/90">
          You are here: <strong className="text-amber-300">{currentLocation}</strong>
        </p>
      </div>
    </div>
  );
}
