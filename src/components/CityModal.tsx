import React from "react";

export default function CityModal({ name, description, gym, onClose, onChallenge, onHeal }: { name: string; description?: string; gym?: string | null; onClose: () => void; onChallenge?: () => void; onHeal?: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
      <div className="bg-gray-900 p-4 rounded-md w-full max-w-sm text-white">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-sm sm:text-lg font-bold truncate">{name}</div>
          <button className="pixel-btn flex-shrink-0" onClick={onClose}>Close</button>
        </div>
        <div className="mb-3 text-xs sm:text-sm">{description ?? "A small town."}</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <button className="pixel-btn w-full" onClick={() => { if (onHeal) onHeal(); }}>PokéCenter (Heal)</button>
          <button className="pixel-btn w-full" onClick={() => alert("Shop (not implemented).")}>Shop</button>
          {gym && <button className="pixel-btn w-full" onClick={() => onChallenge && onChallenge()}>Challenge Gym ({gym})</button>}
        </div>
      </div>
    </div>
  );
}

