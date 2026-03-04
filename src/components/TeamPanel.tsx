import React from "react";

export default function TeamPanel({ player, onClose, onSetLead }: { player: any; onClose: () => void; onSetLead: (index: number) => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
      <div className="bg-gray-900 text-white p-4 rounded-md w-full max-w-md max-h-[85vh] overflow-y-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="font-bold text-xs sm:text-base truncate">Team — {player.name}</div>
          <button className="pixel-btn flex-shrink-0" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-2">
          {(player.team || []).map((m: any, i: number) => (
            <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-800 p-2 rounded">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <img src={m.sprite} className="w-12 h-12 flex-shrink-0" alt={m.name} />
                <div className="min-w-0">
                  <div className="font-bold text-xs sm:text-base truncate">{m.name} Lv {m.level}</div>
                  <div className="text-[10px] sm:text-xs">HP: {m.hp}/{m.maxHp}</div>
                </div>
              </div>
              <button className="pixel-btn w-full sm:w-auto flex-shrink-0" onClick={() => onSetLead(i)}>Set Lead</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

