import React from "react";

export default function CityModal({ name, description, gym, onClose, onChallenge, onHeal }: { name: string; description?: string; gym?: string | null; onClose: () => void; onChallenge?: () => void; onHeal?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center modal-backdrop p-3 sm:p-4 overflow-y-auto">
      <div className="card-panel p-4 w-full max-w-sm text-white border-2 border-amber-500/40">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-sm sm:text-lg font-bold truncate text-amber-300 flex items-center gap-2">🏠 {name}</div>
          <button className="pixel-btn flex-shrink-0 text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="mb-4 text-xs sm:text-sm text-gray-300">{description ?? "A small town."}</div>
        <div className="flex flex-col gap-2">
          <button className="pixel-btn w-full text-xs sm:text-sm" onClick={() => { if (onHeal) onHeal(); }}>💚 PokéCenter (Heal)</button>
          <button className="pixel-btn w-full text-xs sm:text-sm" onClick={() => alert("Shop (not implemented).")}>🛒 Shop</button>
          {gym && (
            <button className="pixel-btn pixel-btn-primary w-full text-xs sm:text-sm" onClick={() => onChallenge?.()}>
              ⚔ Challenge Gym ({gym})
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

