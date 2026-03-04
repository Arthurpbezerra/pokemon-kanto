import React from "react";

export default function LearnMoveModal({
  pokemonName,
  currentMoves,
  newMove,
  onReplace,
  onSkip
}: {
  pokemonName: string;
  currentMoves: string[];
  newMove: string;
  onReplace: (index: number) => void;
  onSkip: () => void;
}) {
  const canAdd = currentMoves.length < 4;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 overflow-y-auto">
      <div className="bg-gray-900 p-4 rounded-md w-full max-w-sm text-white">
        <div className="mb-2 font-bold text-xs sm:text-base">Learn new move?</div>
        <div className="mb-3 text-xs sm:text-sm">{pokemonName} wants to learn <strong>{newMove.split("-").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ")}</strong>.</div>
        {canAdd ? (
          <div className="mb-2 text-xs sm:text-sm">You have a free move slot. Learn it or skip.</div>
        ) : (
          <div className="mb-2 text-xs sm:text-sm">Choose a move to forget, or skip.</div>
        )}
        {!canAdd && (
          <div className="space-y-2 mb-3">
            {currentMoves.map((m, i) => (
              <div key={m} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-800 p-2 rounded">
                <div className="text-xs sm:text-base truncate">{m.split("-").map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(" ")}</div>
                <button className="pixel-btn w-full sm:w-auto" onClick={() => onReplace(i)}>Replace</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          {canAdd && (
            <button className="pixel-btn w-full sm:w-auto" onClick={() => onReplace(-1)}>Learn</button>
          )}
          <button className="pixel-btn w-full sm:w-auto" onClick={onSkip}>Don&apos;t learn</button>
        </div>
      </div>
    </div>
  );
}

