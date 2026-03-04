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
  const newMoveDisplay = newMove.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center modal-backdrop p-3 sm:p-4 overflow-y-auto">
      <div className="card-panel p-4 w-full max-w-sm text-white border-2 border-amber-500/40">
        <div className="mb-2 font-bold text-xs sm:text-base text-amber-300">✨ Learn new move?</div>
        <div className="mb-3 text-xs sm:text-sm text-gray-200">{pokemonName} wants to learn <strong className="text-white">{newMoveDisplay}</strong>.</div>
        {canAdd ? (
          <div className="mb-3 text-xs sm:text-sm text-gray-400">You have a free move slot. Learn it or skip.</div>
        ) : (
          <div className="mb-2 text-xs sm:text-sm text-gray-400">Choose a move to forget, or skip.</div>
        )}
        {!canAdd && (
          <div className="space-y-2 mb-4">
            {currentMoves.map((m, i) => (
              <div key={m} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 bg-gray-800/90 p-2.5 rounded-lg border border-gray-600/50 hover:border-gray-500">
                <div className="text-xs sm:text-base truncate">{m.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")}</div>
                <button className="pixel-btn w-full sm:w-auto text-xs" onClick={() => onReplace(i)}>Replace</button>
              </div>
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          {canAdd && (
            <button className="pixel-btn pixel-btn-primary flex-1 sm:flex-none" onClick={() => onReplace(-1)}>Learn</button>
          )}
          <button className="pixel-btn flex-1 sm:flex-none" onClick={onSkip}>Don&apos;t learn</button>
        </div>
      </div>
    </div>
  );
}

