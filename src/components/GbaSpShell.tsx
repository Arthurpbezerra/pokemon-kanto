import React, { useEffect, useRef } from "react";
import { publicUrl } from "../publicUrl";
import type { Direction } from "../world/tileWorld";

type ControlProps = {
  onDirection: (dir: Direction | null) => void;
  onA: () => void;
  onB: () => void;
  onStart?: () => void;
  onSelect?: () => void;
  onL?: () => void;
  onR?: () => void;
  onMenu?: () => void;
};

type Props = ControlProps & {
  locationLabel: string;
  onOpenChat?: () => void;
  chatPeek?: React.ReactNode;
  padDebug?: boolean;
  children: React.ReactNode;
};

function dirFromPoint(el: HTMLElement, clientX: number, clientY: number): Direction | null {
  const r = el.getBoundingClientRect();
  const dx = clientX - (r.left + r.width / 2);
  const dy = clientY - (r.top + r.height / 2);
  if (dx * dx + dy * dy < 900) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? "left" : "right";
  return dy < 0 ? "up" : "down";
}

function SpHit({
  className,
  label,
  onPress,
  ariaLabel,
  padDebug,
}: {
  className: string;
  label?: string;
  onPress?: () => void;
  ariaLabel: string;
  padDebug?: boolean;
}) {
  return (
    <button
      type="button"
      className={`gba-sp-hit ${className}${padDebug ? " gba-sp-hit--debug" : ""}`}
      aria-label={ariaLabel}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress?.();
      }}
    >
      {label && <span className="gba-sp-hit-label">{label}</span>}
    </button>
  );
}

function GbaSpControls({
  onDirection,
  onA,
  onB,
  onStart,
  onSelect,
  onL,
  onR,
  onMenu,
  padDebug,
}: ControlProps & { padDebug?: boolean }) {
  const padRef = useRef<HTMLDivElement | null>(null);
  const holding = useRef(false);

  useEffect(() => {
    const stop = () => {
      if (!holding.current) return;
      holding.current = false;
      onDirection(null);
    };
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    return () => {
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
    };
  }, [onDirection]);

  return (
    <div className="gba-sp-deck-stage">
      <div className="gba-sp-deck">
        <img
          className="gba-sp-deck-art"
          src={publicUrl("assets/ui/gba-sp-controls.png")}
          alt=""
          draggable={false}
        />
        <div className="gba-sp-deck-overlay">
          <SpHit className="gba-sp-hit--l" label="L" onPress={onL} ariaLabel="L — team" padDebug={padDebug} />
          <SpHit className="gba-sp-hit--r" label="R" onPress={onR} ariaLabel="R — map" padDebug={padDebug} />
          <SpHit className="gba-sp-hit--menu" label="MENU" onPress={onMenu ?? onStart} ariaLabel="Menu" padDebug={padDebug} />
          <div
            ref={padRef}
            className={`gba-sp-hit gba-sp-hit--dpad${padDebug ? " gba-sp-hit--debug" : ""}`}
            role="group"
            aria-label="D-pad"
            onPointerDown={(e) => {
              e.preventDefault();
              holding.current = true;
              (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
              onDirection(dirFromPoint(e.currentTarget, e.clientX, e.clientY));
            }}
            onPointerMove={(e) => {
              if (!holding.current) return;
              onDirection(dirFromPoint(e.currentTarget, e.clientX, e.clientY));
            }}
          />
          <SpHit className="gba-sp-hit--a" label="A" onPress={onA} ariaLabel="A — talk / confirm" padDebug={padDebug} />
          <SpHit className="gba-sp-hit--b" label="B" onPress={onB} ariaLabel="B — back" padDebug={padDebug} />
          <SpHit className="gba-sp-hit--select" label="SELECT" onPress={onSelect} ariaLabel="Select — chat" padDebug={padDebug} />
          <SpHit className="gba-sp-hit--start" label="START" onPress={onStart} ariaLabel="Start — menu" padDebug={padDebug} />
        </div>
      </div>
    </div>
  );
}

/** Mobile GBA SP shell: emulator-style layout — 3:2 game stage + capped control deck. */
export default function GbaSpShell({
  locationLabel,
  onOpenChat,
  chatPeek,
  padDebug = false,
  children,
  onDirection,
  onA,
  onB,
  onStart,
  onSelect,
  onL,
  onR,
  onMenu,
}: Props) {
  return (
    <div className="gba-sp-shell">
      <header className="gba-sp-chrome">
        <span className="gba-sp-chrome-title">{locationLabel}</span>
        {onOpenChat && (
          <button type="button" className="gba-sp-chat-chip" onClick={onOpenChat} aria-label="Open room chat">
            CHAT
          </button>
        )}
      </header>

      <div className="gba-sp-play-column">
        <div className="gba-sp-screen-stage">
          <div className="gba-sp-screen-frame">{children}</div>
        </div>
        {chatPeek && <div className="gba-sp-chat-peek">{chatPeek}</div>}
      </div>

      <GbaSpControls
        onDirection={onDirection}
        onA={onA}
        onB={onB}
        onStart={onStart}
        onSelect={onSelect ?? onOpenChat}
        onL={onL}
        onR={onR}
        onMenu={onMenu}
        padDebug={padDebug}
      />
    </div>
  );
}
