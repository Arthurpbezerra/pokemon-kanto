import React, { useEffect, useRef, useState } from "react";

export type RoomChatMessage = {
  id: string;
  playerId: string;
  playerName: string;
  text: string;
  ts: number;
};

type Props = {
  messages: RoomChatMessage[];
  onSend: (text: string) => void;
  disabled?: boolean;
  disabledHint?: string;
  myPlayerId?: string | null;
  variant?: "sidebar" | "drawer" | "sheet" | "peek";
  open?: boolean;
  onClose?: () => void;
  onOpen?: () => void;
};

export default function RoomChat({
  messages,
  onSend,
  disabled,
  disabledHint,
  myPlayerId,
  variant = "sidebar",
  open = true,
  onClose,
  onOpen,
}: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  useEffect(() => {
    if (variant !== "sheet" || !open) return;

    const vv = window.visualViewport;
    if (!vv) return;

    const onResize = () => {
      const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKeyboardOffset(offset);
    };

    vv.addEventListener("resize", onResize);
    vv.addEventListener("scroll", onResize);
    onResize();

    return () => {
      vv.removeEventListener("resize", onResize);
      vv.removeEventListener("scroll", onResize);
    };
  }, [variant, open]);

  const submit = () => {
    const text = draft.trim();
    if (!text || disabled) return;
    onSend(text);
    setDraft("");
  };

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  if (variant === "peek") {
    if (!lastMessage) return null;
    return (
      <button
        type="button"
        className="room-chat-peek-line"
        onClick={onOpen}
        aria-label="Open room chat"
      >
        <span className="room-chat-peek-name">{lastMessage.playerName}</span>
        <span className="room-chat-peek-text">{lastMessage.text}</span>
      </button>
    );
  }

  if (variant === "drawer" && !open) return null;
  if (variant === "sheet" && !open) return null;

  const panelClass =
    variant === "sheet"
      ? "room-chat-sheet"
      : variant === "drawer"
        ? "room-chat-drawer"
        : "room-chat-sidebar";

  const content = (
    <>
      <div className="room-chat-header">
        <span className="room-chat-title">Room chat</span>
        {(variant === "drawer" || variant === "sheet") && onClose && (
          <button type="button" className="room-chat-close pixel-btn" onClick={onClose} aria-label="Close chat">
            ✕
          </button>
        )}
      </div>
      <div className="room-chat-body">
        <div ref={listRef} className="room-chat-messages" role="log" aria-live="polite">
          {messages.length === 0 && (
            <div className="room-chat-empty">No messages yet. Say hello!</div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`room-chat-line ${m.playerId === myPlayerId ? "room-chat-line--self" : ""}`}>
              <span className="room-chat-name">{m.playerName}</span>
              <span className="room-chat-text">{m.text}</span>
            </div>
          ))}
        </div>
        <form
          className="room-chat-form"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            type="text"
            className="room-chat-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={disabled ? disabledHint ?? "Chat unavailable" : "Message…"}
            maxLength={120}
            disabled={disabled}
            aria-label="Room chat message"
          />
          <button type="submit" className="pixel-btn room-chat-send" disabled={disabled || !draft.trim()}>
            Send
          </button>
        </form>
      </div>
    </>
  );

  if (variant === "sheet") {
    return (
      <>
        <div className="room-chat-backdrop room-chat-backdrop--sheet" onClick={onClose} aria-hidden />
        <div
          ref={sheetRef}
          className={panelClass}
          style={{ bottom: keyboardOffset > 0 ? `${keyboardOffset}px` : undefined }}
        >
          {content}
        </div>
      </>
    );
  }

  if (variant === "drawer") {
    return (
      <>
        <div className="room-chat-backdrop" onClick={onClose} aria-hidden />
        <div className={panelClass}>{content}</div>
      </>
    );
  }

  return <div className={panelClass}>{content}</div>;
}
