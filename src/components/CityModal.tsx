import React from "react";

const POKEBALL_PRICE = 1;

export default function CityModal({
  name,
  description,
  gym,
  onClose,
  onChallenge,
  onHeal,
  coins = 0,
  pokeballCount = 0,
  onBuyPokeball
}: {
  name: string;
  description?: string;
  gym?: string | null;
  onClose: () => void;
  onChallenge?: () => void;
  onHeal?: () => void;
  coins?: number;
  pokeballCount?: number;
  onBuyPokeball?: () => boolean;
}) {
  const canBuy = coins >= POKEBALL_PRICE && onBuyPokeball;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center modal-backdrop p-3 sm:p-4 overflow-y-auto">
      <div className="card-panel p-4 w-full max-w-sm text-white border-2 border-amber-500/40">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="text-sm sm:text-lg font-bold truncate text-amber-300 flex items-center gap-2">🏠 {name}</div>
          <button className="pixel-btn flex-shrink-0 text-xs" onClick={onClose}>Close</button>
        </div>
        <div className="mb-2 text-xs sm:text-sm text-gray-300">{description ?? "A small town."}</div>
        <div className="mb-3 text-xs text-amber-200/90">💰 {coins} coins · 🎒 {pokeballCount} Poké Balls</div>
        <div className="flex flex-col gap-2">
          <button className="pixel-btn w-full text-xs sm:text-sm" onClick={() => { if (onHeal) onHeal(); }}>💚 PokéCenter (Heal)</button>
          <div className="border border-amber-600/40 rounded-lg p-2 bg-black/20">
            <div className="text-xs font-bold text-amber-300 mb-1">🛒 Shop</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs">Poké Ball — {POKEBALL_PRICE} coin</span>
              <button
                className="pixel-btn text-xs flex-shrink-0"
                disabled={!canBuy}
                onClick={() => canBuy && onBuyPokeball?.()}
              >
                Buy
              </button>
            </div>
          </div>
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

