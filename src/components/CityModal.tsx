import React from "react";

const POKEBALL_PRICE = 1;

export default function CityModal({
  name,
  description,
  gym,
  gymLeaderSprite,
  hasBadge,
  league,
  badgeCount = 0,
  onClose,
  onChallenge,
  onChallengeLeague,
  onHeal,
  coins = 0,
  pokeballCount = 0,
  onBuyPokeball
}: {
  name: string;
  description?: string;
  gym?: string | null;
  gymLeaderSprite?: string | null;
  hasBadge?: boolean;
  league?: boolean;
  badgeCount?: number;
  onClose: () => void;
  onChallenge?: () => void;
  onChallengeLeague?: () => void;
  onHeal?: () => void;
  coins?: number;
  pokeballCount?: number;
  onBuyPokeball?: () => boolean;
}) {
  const canBuy = coins >= POKEBALL_PRICE && onBuyPokeball;
  const canEnterLeague = league && badgeCount >= 8 && onChallengeLeague;
  const isViridianGym = gym === "Giovanni";
  const canChallengeGym = gym && !hasBadge && (!isViridianGym || badgeCount >= 7);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center modal-backdrop p-3 sm:p-4 overflow-y-auto">
      <div className="card-panel p-4 w-full max-w-sm text-white border-2 border-amber-500/40">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <h2 className="section-title truncate flex items-center gap-2 mb-0">🏠 {name}</h2>
          <button className="pixel-btn flex-shrink-0 text-xs" onClick={onClose}>Close</button>
        </div>
        <p className="mb-2 text-xs sm:text-sm text-gray-300">{description ?? "A small town."}</p>
        <p className="mb-3 text-muted">💰 {coins} coins · 🎒 {pokeballCount} Poké Balls · 🏅 {badgeCount}/8 badges</p>
        <div className="flex flex-col gap-2">
          <button className="pixel-btn w-full text-xs sm:text-sm" onClick={() => { if (onHeal) onHeal(); }}>💚 PokéCenter (Heal)</button>
          <div className="border border-amber-600/40 rounded-lg p-2 bg-black/20">
            <div className="section-title mb-1">🛒 Shop</div>
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
            hasBadge ? (
              <div className="rounded-lg bg-amber-900/30 border border-amber-600/50 px-3 py-2 text-xs sm:text-sm text-amber-200 flex items-center gap-2">
                {gymLeaderSprite && <img src={gymLeaderSprite} alt={gym} className="w-10 h-10 object-contain bg-gray-900 rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                ✓ Badge obtained ({gym})
              </div>
            ) : (
              <div className="rounded-lg border border-amber-600/50 bg-amber-950/30 p-2 flex flex-col gap-2">
                <div className="flex items-center gap-3">
                  {gymLeaderSprite && <img src={gymLeaderSprite} alt={gym} className="w-14 h-14 object-contain bg-gray-900 rounded flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                  <button
                    className="pixel-btn pixel-btn-primary flex-1 text-xs sm:text-sm"
                    disabled={!canChallengeGym}
                    onClick={() => canChallengeGym && onChallenge?.()}
                    title={isViridianGym && badgeCount < 7 ? "You need 7 badges to challenge this gym (last gym)." : undefined}
                  >
                    ⚔ Challenge Gym ({gym})
                  </button>
                </div>
                {isViridianGym && badgeCount < 7 && (
                  <p className="text-muted text-[10px] sm:text-xs">You need 7 badges to challenge this gym.</p>
                )}
              </div>
            )
          )}
          {league && (
            <button
              className="pixel-btn w-full text-xs sm:text-sm border-2 border-amber-500"
              disabled={!canEnterLeague}
              onClick={() => canEnterLeague && onChallengeLeague?.()}
              title={badgeCount < 8 ? "You need 8 badges to challenge the League." : undefined}
            >
              🏆 Pokémon League {badgeCount < 8 ? `(${badgeCount}/8 badges)` : "— Challenge!"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

