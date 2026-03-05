/**
 * Simple sound effects and optional music.
 * Add files to public/sounds/ with these names (either .mp3 or .mp4):
 *   battle-start, capture, level-up, evolution, achievement, gym-victory, attack, run, button
 * Example: battle-start.mp3 or gym-victory.mp3
 */

const STORAGE_MUTE = "pokemon-kanto-mute";

const SOUND_KEYS = ["battle-start", "capture", "level-up", "evolution", "achievement", "gym-victory", "attack", "run", "button"] as const;
export type SfxKey = (typeof SOUND_KEYS)[number];

const base = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) || "/";
const basePath = base.endsWith("/") ? `${base}sounds` : `${base}/sounds`;

function getStoredMute(): boolean {
  try {
    return localStorage.getItem(STORAGE_MUTE) === "1";
  } catch {
    return false;
  }
}

let muted = getStoredMute();

export function isMuted(): boolean {
  return muted;
}

export function setMuted(value: boolean): void {
  muted = value;
  try {
    localStorage.setItem(STORAGE_MUTE, value ? "1" : "0");
  } catch {}
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(STORAGE_MUTE, muted ? "1" : "0");
  } catch {}
  return muted;
}

const VOLUME = 0.7;

function tryPlay(path: string, volume = VOLUME): Promise<void> {
  return new Promise((resolve, reject) => {
    const audio = new Audio(path);
    audio.volume = volume;
    audio.oncanplaythrough = () => {
      audio.currentTime = 0;
      audio.play().then(resolve).catch(reject);
    };
    audio.onerror = () => reject(new Error("load failed"));
  });
}

let audioUnlocked = false;
const preloaded: Record<string, HTMLAudioElement> = {};
const stopTimeouts: Record<string, ReturnType<typeof setTimeout>> = {};

/** Keys that auto-stop after a few seconds (so long clips don't run forever). */
const AUTO_STOP_KEYS = ["level-up", "capture", "evolution", "achievement", "gym-victory"] as const;
const AUTO_STOP_SECONDS = 2.5;
/** Longer stop for fanfare-style sounds (e.g. gym victory). */
const GYM_VICTORY_STOP_SECONDS = 5;

function getPath(key: string, ext: "mp3" | "mp4"): string {
  return `${basePath}/${key}.${ext}`;
}

/** Stops playback for a sound (e.g. battle-start when battle ends). */
export function stopSfx(key: SfxKey | string): void {
  const el = preloaded[key as string];
  if (el) {
    el.pause();
    el.currentTime = 0;
  }
  const tid = stopTimeouts[key as string];
  if (tid) {
    clearTimeout(tid);
    delete stopTimeouts[key as string];
  }
}

/** Call from a user gesture (e.g. first click). Unlocks audio and starts preloading .mp3 files. */
export function unlockAudio(): void {
  if (audioUnlocked) return;
  audioUnlocked = true;
  if (!muted) {
    const silentWav = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const a = new Audio(silentWav);
    a.volume = 0;
    a.play().catch(() => {});
  }

  SOUND_KEYS.forEach((key) => {
    const el = new Audio(getPath(key, "mp3"));
    el.volume = VOLUME;
    el.preload = "auto";
    el.load();
    preloaded[key] = el;
  });
}

export function playSfx(key: SfxKey | string): void {
  if (muted) return;
  const k = key as string;
  const pre = preloaded[k];
  if (pre && pre.readyState >= 2) {
    if (AUTO_STOP_KEYS.includes(k as any) && !pre.paused && pre.currentTime > 0.1) {
      return;
    }
    if (stopTimeouts[k]) {
      clearTimeout(stopTimeouts[k]);
      delete stopTimeouts[k];
    }
    pre.currentTime = 0;
    pre.volume = VOLUME;
    pre.play().catch(() => {});
    if (AUTO_STOP_KEYS.includes(k as any)) {
      const stopMs = k === "gym-victory" ? GYM_VICTORY_STOP_SECONDS * 1000 : AUTO_STOP_SECONDS * 1000;
      stopTimeouts[k] = setTimeout(() => stopSfx(k), stopMs);
    }
    return;
  }
  if (stopTimeouts[k]) {
    clearTimeout(stopTimeouts[k]);
    delete stopTimeouts[k];
  }
  const pathBase = `${basePath}/${key}`;
  tryPlay(`${pathBase}.mp3`).catch(() => tryPlay(`${pathBase}.mp4`).catch(() => {}));
  if (AUTO_STOP_KEYS.includes(k as any)) {
    const stopMs = k === "gym-victory" ? GYM_VICTORY_STOP_SECONDS * 1000 : AUTO_STOP_SECONDS * 1000;
    stopTimeouts[k] = setTimeout(() => stopSfx(k), stopMs);
  }
}

export function playMusic(url: string, loop = true): void {
  if (muted) return;
  if (!audioUnlocked) unlockAudio();
  if (!bgm) {
    bgm = new Audio();
    bgm.volume = 0.4;
  }
  currentMusicUrl = url;
  bgm.pause();
  bgm.currentTime = 0;
  bgm.loop = loop;
  bgm.src = url;
  bgm.play().catch(() => {});
}

/** Singleton BGM: uma única instância de áudio para toda a aplicação. */
let bgm: HTMLAudioElement | null = null;
let currentMusicUrl: string | null = null;

/** Toca uma música por URL. Usa instância única; para qualquer BGM anterior. */
export function playMusicWhenReady(url: string, loop = false): void {
  if (muted) return;
  if (!audioUnlocked) unlockAudio();
  if (!bgm) {
    bgm = new Audio();
    bgm.volume = 0.5;
  }
  if (!loop && currentMusicUrl === url && !bgm.paused) return;
  currentMusicUrl = url;
  bgm.pause();
  bgm.currentTime = 0;
  bgm.loop = loop;
  bgm.src = url;
  bgm.play().catch(() => {});
}

export function stopMusic(): void {
  if (bgm) {
    bgm.pause();
    bgm.currentTime = 0;
  }
}
