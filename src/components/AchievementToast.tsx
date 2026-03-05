import React, { useEffect, useRef, useState } from "react";
import * as sound from "../audio/sound";

export type AchievementData = {
  type: "gym" | "capture" | string;
  playerName: string;
  gymLeader?: string;
  pokemonName?: string;
  ts?: number;
};

const TOAST_DURATION_MS = 5500;

export default function AchievementToast({
  data,
  onClose,
}: {
  data: AchievementData;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(false);
  const soundPlayedRef = useRef(false);

  useEffect(() => {
    if (!soundPlayedRef.current) {
      soundPlayedRef.current = true;
      if (data.type === "gym") sound.playSfx("gym-victory");
      else sound.playSfx("achievement");
    }
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, [data.type]);

  useEffect(() => {
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(onClose, 300);
    }, TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [onClose]);

  const message =
    data.type === "gym" && data.gymLeader
      ? `${data.playerName} defeated ${data.gymLeader}!`
      : data.type === "capture" && data.pokemonName
        ? `${data.playerName} caught ${data.pokemonName}!`
        : `${data.playerName} achieved something!`;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[60] max-w-[90vw] sm:max-w-md transition-all duration-300 ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-4"
      }`}
    >
      <div className="card-panel border-2 border-amber-500/70 shadow-lg shadow-amber-500/20 px-4 py-3 flex items-center gap-3">
        <span className="text-2xl sm:text-3xl flex-shrink-0" aria-hidden>
          🏆
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] sm:text-xs text-amber-400/90 uppercase tracking-wider font-bold mb-0.5">
            Achievement
          </div>
          <div className="text-xs sm:text-sm font-bold text-white truncate">
            {message}
          </div>
        </div>
      </div>
    </div>
  );
}
