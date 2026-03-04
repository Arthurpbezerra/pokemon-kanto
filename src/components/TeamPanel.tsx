import React from "react";

function hpColor(cur: number, max: number) {
  const pct = cur / max;
  if (pct > 0.6) return "bg-green-500";
  if (pct > 0.3) return "bg-yellow-500";
  return "bg-red-500";
}

export default function TeamPanel({ player, onClose, onSetLead }: { player: any; onClose: () => void; onSetLead: (index: number) => void }) {
  const team = player.team || [];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-3 sm:p-4 overflow-y-auto">
      <div className="card-panel text-white p-4 w-full max-w-md max-h-[85vh] overflow-y-auto border-2 border-amber-500/40">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="font-bold text-xs sm:text-base truncate text-amber-300">👥 Team — {player.name}</div>
          <button className="pixel-btn flex-shrink-0 text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-3">
          {team.map((m: any, i: number) => {
            const isLead = i === 0;
            const maxHp = m.maxHp ?? 1;
            const curHp = m.hp ?? 0;
            const pct = Math.max(0, (curHp / maxHp) * 100);
            return (
              <div
                key={i}
                className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-800/90 p-3 rounded-lg border ${isLead ? "border-amber-500/60 ring-1 ring-amber-400/30" : "border-gray-600/50"} hover:border-gray-500 transition-colors`}
              >
                <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                  <div className="relative flex-shrink-0">
                    <img src={m.sprite} className="w-14 h-14 sm:w-16 sm:h-16 object-contain bg-gray-900 rounded-lg p-0.5" alt={m.name} />
                    {isLead && <span className="absolute -top-1 -right-1 text-amber-400 text-xs" title="Lead">★</span>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-xs sm:text-base truncate">{m.name} <span className="text-gray-400 font-normal">Lv{m.level}</span></div>
                    <div className="mt-1.5 h-2 hp-bar bg-gray-700 rounded w-full max-w-[120px]">
                      <div className={`hp-bar-fill h-2 ${hpColor(curHp, maxHp)}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="text-[10px] sm:text-xs text-gray-400 mt-0.5">{curHp}/{maxHp} HP</div>
                  </div>
                </div>
                {!isLead && (
                  <button className="pixel-btn w-full sm:w-auto flex-shrink-0 text-xs" onClick={() => onSetLead(i)}>Set Lead</button>
                )}
                {isLead && <span className="text-[10px] text-amber-400 sm:px-2">Lead</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

