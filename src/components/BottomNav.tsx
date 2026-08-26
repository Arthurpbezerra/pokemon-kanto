import React from "react";

export default function BottomNav({ onTeam, onMap, onMenu, className }: { onTeam: () => void; onMap: () => void; onMenu: () => void; className?: string }) {
  const items = [
    { label: "Team", icon: "👥", onClick: onTeam },
    { label: "Map", icon: "🗺", onClick: onMap },
    { label: "Menu", icon: "☰", onClick: onMenu },
  ];
  return (
    <div className={`app-bottom-nav safe-area-bottom ${className ?? ""}`}>
      {items.map(({ label, icon, onClick }) => (
        <button
          key={label}
          type="button"
          className="pixel-btn flex-1 min-w-0 flex flex-col items-center gap-0.5 py-2 text-[10px] sm:text-xs max-w-[100px] sm:max-w-[120px]"
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

