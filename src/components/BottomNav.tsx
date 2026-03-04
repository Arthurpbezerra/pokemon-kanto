import React from "react";

export default function BottomNav({ onSearch, onTeam, onMap, onMenu }: { onSearch: () => void; onTeam: () => void; onMap: () => void; onMenu: () => void }) {
  const items = [
    { label: "Search", icon: "🔍", onClick: onSearch },
    { label: "Team", icon: "👥", onClick: onTeam },
    { label: "Map", icon: "🗺", onClick: onMap },
    { label: "Menu", icon: "☰", onClick: onMenu },
  ];
  return (
    <div className="app-bottom-nav safe-area-bottom">
      {items.map(({ label, icon, onClick }) => (
        <button
          key={label}
          type="button"
          className="pixel-btn flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[8px] sm:text-[10px] max-w-[90px] sm:max-w-[110px]"
          onClick={onClick}
          aria-label={label}
        >
          <span className="text-sm sm:text-base leading-none" aria-hidden>{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

