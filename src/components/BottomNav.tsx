import React from "react";

export default function BottomNav({ onSearch, onTeam, onMap, onMenu }: { onSearch: () => void; onTeam: () => void; onMap: () => void; onMenu: () => void }) {
  return (
    <div className="app-bottom-nav safe-area-bottom">
      <button type="button" className="pixel-btn flex-1 min-w-0 text-[8px] sm:text-[10px] max-w-[100px] sm:max-w-none" onClick={onSearch}>Search</button>
      <button type="button" className="pixel-btn flex-1 min-w-0 text-[8px] sm:text-[10px] max-w-[100px] sm:max-w-none" onClick={onTeam}>Team</button>
      <button type="button" className="pixel-btn flex-1 min-w-0 text-[8px] sm:text-[10px] max-w-[100px] sm:max-w-none" onClick={onMap}>Map</button>
      <button type="button" className="pixel-btn flex-1 min-w-0 text-[8px] sm:text-[10px] max-w-[100px] sm:max-w-none" onClick={onMenu}>Menu</button>
    </div>
  );
}

