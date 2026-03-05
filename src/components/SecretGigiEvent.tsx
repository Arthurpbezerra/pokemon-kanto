import React, { useEffect, useRef, useState } from "react";
import * as sound from "../audio/sound";
import {
  SECRET_TEXTS,
  SECRET_ASSETS,
  EEVEE_SPRITE,
} from "../secret-gigi.config";

const GIGI_STORAGE_PLAYED = "gigi-music-played";
const GIGI_STORAGE_COMPLETED = "gigi-event-completed";

/** Limpa o estado do evento Gigi (chame ao voltar à home para que numa nova partida a música toque de novo). */
export function clearGigiEventStorage(): void {
  try {
    sessionStorage.removeItem(GIGI_STORAGE_PLAYED);
    sessionStorage.removeItem(GIGI_STORAGE_COMPLETED);
  } catch {}
}

function gigiMusicShouldPlay(): boolean {
  try {
    if (typeof sessionStorage === "undefined") return true;
    if (sessionStorage.getItem(GIGI_STORAGE_COMPLETED) === "1") return false;
    if (sessionStorage.getItem(GIGI_STORAGE_PLAYED) === "1") return false;
    return true;
  } catch {
    return true;
  }
}

function gigiMarkMusicPlayed(): void {
  try {
    sessionStorage.setItem(GIGI_STORAGE_PLAYED, "1");
  } catch {}
}

function gigiMarkCompleted(): void {
  try {
    sessionStorage.setItem(GIGI_STORAGE_COMPLETED, "1");
  } catch {}
}

type Props = {
  playerName: string;
  onComplete: () => void;
};

const GAMEBOY_BG = "#0f380f";
const GAMEBOY_TEXT = "#9bbc0f";
const GAMEBOY_TEXT_DARK = "#8bac0f";

export default function SecretGigiEvent({ playerName, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const effectHasRunRef = useRef(false);

  useEffect(() => {
    if (effectHasRunRef.current) return;
    effectHasRunRef.current = true;

    sound.unlockAudio();
    if (gigiMusicShouldPlay()) {
      gigiMarkMusicPlayed();
      sound.playMusicWhenReady(SECRET_ASSETS.music, false);
    }
    // Não parar a música no cleanup: no StrictMode (dev) o unmount é fake e parar aqui
    // fazia a música parar e depois tocar de novo no remount. Só paramos em handleComplete.
  }, []);

  const handleComplete = () => {
    gigiMarkCompleted();
    // Não parar a música aqui: deixar tocar até acabar naturalmente
    onComplete();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center p-4 overflow-y-auto"
      style={{ background: GAMEBOY_BG }}
    >
      {/* Step 0: Intro — tela escurece + texto estilo Game Boy */}
      {step === 0 && (
        <div className="flex flex-col items-center justify-center text-center max-w-md animate-fade-in">
          <p
            className="text-sm sm:text-base mb-4 leading-relaxed"
            style={{ color: GAMEBOY_TEXT, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.intro}
          </p>
          <p
            className="text-sm sm:text-base mb-8 leading-relaxed"
            style={{ color: GAMEBOY_TEXT_DARK, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.found(playerName)}
          </p>
          <button
            type="button"
            className="pixel-btn text-xs"
            style={{ color: GAMEBOY_TEXT, borderColor: GAMEBOY_TEXT }}
            onClick={() => setStep(1)}
          >
            Continuar
          </button>
        </div>
      )}

      {/* Step 1: Sprite do Eevee + "escolheu você!" */}
      {step === 1 && (
        <div className="flex flex-col items-center justify-center text-center max-w-md animate-fade-in">
          <img
            src={EEVEE_SPRITE}
            alt="Eevee"
            className="w-32 h-32 sm:w-40 sm:h-40 object-contain mb-6"
          />
          <p
            className="text-sm sm:text-base mb-8 leading-relaxed"
            style={{ color: GAMEBOY_TEXT, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.choseYou}
          </p>
          <button
            type="button"
            className="pixel-btn text-xs"
            style={{ color: GAMEBOY_TEXT, borderColor: GAMEBOY_TEXT }}
            onClick={() => setStep(2)}
          >
            Continuar
          </button>
        </div>
      )}

      {/* Step 2: gigi-pixel + diálogo para pegar Eevee como inicial */}
      {step === 2 && (
        <div className="flex flex-col items-center justify-center text-center max-w-md animate-fade-in">
          <img
            src={SECRET_ASSETS.gigiPixel}
            alt=""
            className="w-48 h-48 sm:w-56 sm:h-56 object-contain mb-4 rounded-lg border-2 border-green-600"
          />
          <p
            className="text-xs sm:text-sm mb-6 leading-relaxed"
            style={{ color: GAMEBOY_TEXT, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.dialogueGigi}
          </p>
          <button
            type="button"
            className="pixel-btn pixel-btn-primary text-xs"
            style={{ borderColor: GAMEBOY_TEXT, color: GAMEBOY_TEXT }}
            onClick={() => setStep(3)}
          >
            {SECRET_TEXTS.dialogueButton}
          </button>
        </div>
      )}

      {/* Step 3: tutu-e-gigi + mensagem de amor */}
      {step === 3 && (
        <div className="flex flex-col items-center justify-center text-center max-w-md animate-fade-in">
          <img
            src={SECRET_ASSETS.tutuEGigi}
            alt="Tutu e Gigi"
            className="w-full max-w-sm rounded-lg border-2 border-green-600 shadow-lg mb-6"
          />
          <p
            className="text-xs sm:text-sm font-bold mb-2"
            style={{ color: GAMEBOY_TEXT, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.loveTitle}
          </p>
          <p
            className="text-xs sm:text-sm mb-8 leading-relaxed"
            style={{ color: GAMEBOY_TEXT_DARK, fontFamily: '"Press Start 2P", cursive' }}
          >
            {SECRET_TEXTS.loveMessage}
          </p>
          <button
            type="button"
            className="pixel-btn text-xs"
            style={{ color: GAMEBOY_TEXT, borderColor: GAMEBOY_TEXT }}
            onClick={handleComplete}
          >
            Começar aventura
          </button>
        </div>
      )}
    </div>
  );
}
