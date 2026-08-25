import React, { useEffect, useRef, useState } from "react";
import { calculateDamage, calculateDamageWithTypes, whoGoesFirst, getMoveStatusEffect, isImmuneToStatus, effectiveSpeed, getMoveDrainRatio, type StatusType } from "../engine/battle";
import { getMoveData, formatMoveName, prefetchMoveData, xpForDefeatingEnemy } from "../api/pokeapi";

const STRUGGLE = { name: "struggle", power: 50, accuracy: 100, damage_class: "physical", type: "normal", pp: 1 };

type PokemonInstance = {
  id: number;
  name: string;
  sprite: string;
  level: number;
  hp: number;
  maxHp: number;
  types?: string[];
  stats?: { attack: number; defense: number; speed: number };
  moves?: string[];
  xp?: number;
  xpToNext?: number;
  status?: StatusType | null;
  sleepTurnsLeft?: number;
  leechSeed?: boolean;
};

export type BattleEndResult = { winner: "player" | "enemy" | "run"; xpGain?: number; playerFinalHp?: number; enemyFinalHp?: number; participantIds?: number[] };

function getHp(m: { hp?: number } | null | undefined): number {
  return m && typeof (m as { hp?: number }).hp === "number" ? (m as { hp: number }).hp : 0;
}

type PvpBattleState = {
  log: string[];
  status: "waiting_moves" | "resolving" | "ended" | "waiting_switch";
  myMoveSubmitted?: boolean;
  mustSwitch?: boolean;
  winner?: "challenger" | "defender" | null;
};

type Props = {
  playerPokemon: PokemonInstance;
  enemyPokemon: PokemonInstance;
  playerTeam?: PokemonInstance[];
  onEnd: (result: BattleEndResult) => void;
  onPlayerUpdate: (p: PokemonInstance) => void;
  onSwitchPokemon?: (teamIndex: number) => void;
  onCapture?: () => boolean | Promise<boolean>;
  pokeballCount?: number;
  potionCount?: number;
  superPotionCount?: number;
  onUsePotion?: (type: "potion" | "superpotion") => void;
  onGrantXp?: (xp: number) => void;
  isPvP?: boolean;
  isTrainerBattle?: boolean;
  pvpBattleState?: PvpBattleState;
  onPvpSubmitMove?: (moveName: string) => void;
  pvpYouWon?: boolean;
};

const CRY_BASE = "https://raw.githubusercontent.com/PokeAPI/cries/main/cries/pokemon/latest";

const BATTLE_BG: Record<string, string> = {
  grass: "battle-bg-grass",
  water: "battle-bg-water",
  cave: "battle-bg-cave",
  town: "battle-bg-town",
};

function playCry(pokemonId: number) {
  try {
    const a = new Audio(`${CRY_BASE}/${pokemonId}.ogg`);
    a.volume = 0.3;
    a.play().catch(() => {});
  } catch {}
}

export default function BattleModal({ playerPokemon, enemyPokemon, playerTeam, onEnd, onPlayerUpdate, onSwitchPokemon, onCapture, pokeballCount = 0, potionCount = 0, superPotionCount = 0, onUsePotion, onGrantXp, isPvP, isTrainerBattle, pvpBattleState, onPvpSubmitMove, pvpYouWon, locationType }: Props & { locationType?: string }) {
  const [p, setP] = useState<PokemonInstance>(() => ({ ...playerPokemon }));
  const [e, setE] = useState<PokemonInstance>(() => ({ ...enemyPokemon }));
  const [showMoves, setShowMoves] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [faintedLeadId, setFaintedLeadId] = useState<number | null>(null);
  const [showVoluntarySwitch, setShowVoluntarySwitch] = useState(false);
  const enemyHpAfterFirstAttackRef = useRef<number>(0);
  const playerHpAfterFirstAttackRef = useRef<number>(0);
  const participantIdsRef = useRef<Set<number>>(new Set());
  const playerStillAsleepRef = useRef(false);
  const enemyStillAsleepRef = useRef(false);
  const enemyLeechDrainRef = useRef(0);
  const playerLeechDrainRef = useRef(0);
  const [ppMap, setPpMap] = useState<Record<string, number>>({});
  const ppInitRef = useRef(false);

  const [captureAnim, setCaptureAnim] = useState<"throw" | "wobble" | "click" | "escape" | null>(null);
  const [shakeTarget, setShakeTarget] = useState<"player" | "enemy" | null>(null);
  const [flashTarget, setFlashTarget] = useState<"player" | "enemy" | null>(null);
  const [typeOverlay, setTypeOverlay] = useState<{ target: "player" | "enemy"; type: string } | null>(null);
  const [faintAnim, setFaintAnim] = useState<"player" | "enemy" | null>(null);
  const [battleEntered, setBattleEntered] = useState(false);

  const VICTORY_CLOSE_MS = 500;

  // Do NOT sync from props after mount: parent's enemyPokemon always has full HP.
  // Resyncing would overwrite local battle damage and make the enemy "heal" on every parent re-render.

  // clear log only on initial mount + entrance animation
  useEffect(() => {
    setLog([]);
    setBattleEntered(true);
    playCry(enemyPokemon.id);
    const t = setTimeout(() => playCry(playerPokemon.id), 300);
    return () => clearTimeout(t);
  }, []);

  // Init participants with initial lead
  useEffect(() => {
    participantIdsRef.current.add(playerPokemon.id);
  }, []);

  useEffect(() => {
    if (ppInitRef.current) return;
    ppInitRef.current = true;
    const moves = playerPokemon.moves ?? [];
    if (moves.length === 0) return;
    Promise.all(moves.map((m) => getMoveData(m).then((d) => ({ name: m, pp: d.pp ?? 35 })).catch(() => ({ name: m, pp: 35 }))))
      .then((entries) => {
        const map: Record<string, number> = {};
        entries.forEach((e) => { map[e.name] = e.pp; });
        setPpMap(map);
      });
  }, [playerPokemon.moves]);

  useEffect(() => {
    const playerMoves = playerPokemon.moves ?? [];
    const enemyMoves = enemyPokemon.moves ?? [];
    const all = [...playerMoves, ...enemyMoves];
    if (!all.length) return;
    prefetchMoveData(all).catch(() => {});
  }, [playerPokemon.moves, enemyPokemon.moves]);

  // When parent switches lead after we chose another Pokémon, update local player state
  useEffect(() => {
    if (showSwitchPicker && faintedLeadId !== null && playerPokemon.id !== faintedLeadId) {
      setP({ ...playerPokemon });
      setShowSwitchPicker(false);
      setFaintedLeadId(null);
    }
  }, [showSwitchPicker, faintedLeadId, playerPokemon]);

  useEffect(() => {
    if (showVoluntarySwitch && playerPokemon.id !== p.id) {
      setP({ ...playerPokemon });
      setShowVoluntarySwitch(false);
    }
  }, [showVoluntarySwitch, playerPokemon.id, p.id, playerPokemon]);

  const pushLog = (line: string) =>
    setLog((l) => {
      if (l[0] === line) return l;
      return [line, ...l].slice(0, 8);
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const doMove = async (moveName?: string) => {
    if (busy) return;
    setBusy(true);
    enemyHpAfterFirstAttackRef.current = e.hp;
    playerHpAfterFirstAttackRef.current = p.hp;
    // Decrement sleep at start of turn (Gen 1: sleep counter decreases each turn)
    setP((cur) => {
      if (cur.status === "sleep" && cur.sleepTurnsLeft != null) {
        const next = cur.sleepTurnsLeft - 1;
        if (next <= 0) {
          playerStillAsleepRef.current = false;
          return { ...cur, status: undefined, sleepTurnsLeft: undefined };
        }
        playerStillAsleepRef.current = true;
        return { ...cur, sleepTurnsLeft: next };
      }
      playerStillAsleepRef.current = false;
      return cur;
    });
    setE((cur) => {
      if (cur.status === "sleep" && cur.sleepTurnsLeft != null) {
        const next = cur.sleepTurnsLeft - 1;
        if (next <= 0) {
          enemyStillAsleepRef.current = false;
          return { ...cur, status: undefined, sleepTurnsLeft: undefined };
        }
        enemyStillAsleepRef.current = true;
        return { ...cur, sleepTurnsLeft: next };
      }
      enemyStillAsleepRef.current = false;
      return cur;
    });
    await sleep(0);
    // resolve player's move data
    const isStruggle = moveName === "struggle";
    let playerMove: any = { name: moveName ?? "Attack", power: 40, accuracy: 100, damage_class: "physical", type: "normal" };
    if (isStruggle) {
      playerMove = { ...STRUGGLE };
    } else if (moveName) {
      try {
        playerMove = await getMoveData(moveName);
      } catch {
        playerMove = { name: moveName, power: 40, accuracy: 100, damage_class: "physical", type: "normal" };
      }
      setPpMap((prev) => ({ ...prev, [moveName]: Math.max(0, (prev[moveName] ?? 1) - 1) }));
    }
    const pSpeed = effectiveSpeed(p.stats?.speed ?? 5, p.status);
    const eSpeed = effectiveSpeed(e.stats?.speed ?? 5, e.status);
    const first = whoGoesFirst(pSpeed, eSpeed);
    const attackerFirst = first === "a" ? "player" : "enemy";

    const effectivenessMsg = (eff: "immune" | "weak" | "normal" | "super") => {
      if (eff === "super") return " It's super effective!";
      if (eff === "weak") return " It's not very effective...";
      if (eff === "immune") return " It doesn't affect the target.";
      return "";
    };

    const triggerHitAnim = (target: "player" | "enemy", moveType?: string) => {
      setFlashTarget(target);
      setTimeout(() => setFlashTarget(null), 220);
      setTimeout(() => {
        setShakeTarget(target);
        setTimeout(() => setShakeTarget(null), 350);
      }, 100);
      if (moveType) {
        setTypeOverlay({ target, type: moveType });
        setTimeout(() => setTypeOverlay(null), 550);
      }
    };

    const applyAttack = (attackerIsPlayer: boolean, mvPower: number, mvName?: string, mvClass: string = "physical", moveType?: string, defenderTypes?: string[]) => {
      const drainRatio = getMoveDrainRatio(mvName ?? "");
      triggerHitAnim(attackerIsPlayer ? "enemy" : "player", moveType);
      if (attackerIsPlayer) {
        const atkBase = p.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defBase = e.stats ?? { attack: 5, defense: 5, speed: 5 };
        const stageMult = (s: number) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
        const atkEff = { attack: Math.max(1, Math.floor((atkBase.attack ?? 5) * stageMult((p as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((atkBase.defense ?? 5) * stageMult((p as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((atkBase.speed ?? 5) * stageMult((p as any).stages?.speed ?? 0))), specialAttack: Math.max(1, Math.floor(((atkBase as any).specialAttack ?? 5) * stageMult((p as any).stages?.specialAttack ?? 0))) };
        const defEff = { attack: Math.max(1, Math.floor((defBase.attack ?? 5) * stageMult((e as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((defBase.defense ?? 5) * stageMult((e as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((defBase.speed ?? 5) * stageMult((e as any).stages?.speed ?? 0))), specialDefense: Math.max(1, Math.floor(((defBase as any).specialDefense ?? 5) * stageMult((e as any).stages?.specialDefense ?? 0))) };
        const defenderTy = defenderTypes ?? e.types ?? ["normal"];
        const res = (moveType != null && defenderTy.length)
          ? calculateDamageWithTypes(atkEff as any, defEff as any, mvPower, mvClass ?? "physical", p.level ?? 5, moveType, defenderTy, p.types)
          : { ...calculateDamage(atkEff as any, defEff as any, mvPower, mvClass ?? "physical", p.level ?? 5), effectiveness: "normal" as const };
        setE((cur) => {
          const newHp = Math.max(0, cur.hp - res.damage);
          enemyHpAfterFirstAttackRef.current = newHp;
          pushLog(`${p.name} used ${mvName ?? "Attack"} and dealt ${res.damage}${res.isCrit ? " (CRIT)" : ""}.${effectivenessMsg(res.effectiveness)}`);
          return { ...cur, hp: newHp };
        });
        if (drainRatio > 0 && res.damage > 0) {
          const heal = Math.min((p.maxHp ?? 10) - p.hp, Math.max(0, Math.floor(res.damage * drainRatio)));
          if (heal > 0) {
            setP((cur) => {
              const newHp = Math.min(cur.maxHp ?? 10, cur.hp + heal);
              pushLog(`${cur.name} absorbed health! (+${heal})`);
              try { onPlayerUpdate({ ...cur, hp: newHp }); } catch {}
              return { ...cur, hp: newHp };
            });
          }
        }
      } else {
        const atkBaseE = e.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defBaseP = p.stats ?? { attack: 5, defense: 5, speed: 5 };
        const stageMultE = (s: number) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
        const atkEffE = { attack: Math.max(1, Math.floor((atkBaseE.attack ?? 5) * stageMultE((e as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((atkBaseE.defense ?? 5) * stageMultE((e as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((atkBaseE.speed ?? 5) * stageMultE((e as any).stages?.speed ?? 0))), specialAttack: Math.max(1, Math.floor(((atkBaseE as any).specialAttack ?? 5) * stageMultE((e as any).stages?.specialAttack ?? 0))) };
        const defEffP = { attack: Math.max(1, Math.floor((defBaseP.attack ?? 5) * stageMultE((p as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((defBaseP.defense ?? 5) * stageMultE((p as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((defBaseP.speed ?? 5) * stageMultE((p as any).stages?.speed ?? 0))), specialDefense: Math.max(1, Math.floor(((defBaseP as any).specialDefense ?? 5) * stageMultE((p as any).stages?.specialDefense ?? 0))) };
        const defenderTy = defenderTypes ?? p.types ?? ["normal"];
        const res = (moveType != null && defenderTy.length)
          ? calculateDamageWithTypes(atkEffE as any, defEffP as any, mvPower, mvClass ?? "physical", e.level ?? 5, moveType, defenderTy, e.types)
          : { ...calculateDamage(atkEffE as any, defEffP as any, mvPower, mvClass ?? "physical", e.level ?? 5), effectiveness: "normal" as const };
        setP((cur) => {
          const newHp = Math.max(0, cur.hp - res.damage);
          playerHpAfterFirstAttackRef.current = newHp;
          const updated = { ...cur, hp: newHp };
          pushLog(`${e.name} used ${mvName ?? "Attack"} and dealt ${res.damage}${res.isCrit ? " (CRIT)" : ""}.${effectivenessMsg(res.effectiveness)}`);
          return updated;
        });
        if (drainRatio > 0 && res.damage > 0) {
          const heal = Math.min((e.maxHp ?? 10) - e.hp, Math.max(0, Math.floor(res.damage * drainRatio)));
          if (heal > 0) {
            setE((cur) => {
              pushLog(`${cur.name} absorbed health! (+${heal})`);
              return { ...cur, hp: Math.min(cur.maxHp ?? 10, cur.hp + heal) };
            });
          }
        }
      }
    };

    const applyStatChanges = (attackerIsPlayer: boolean, statChanges: any[], mvName?: string) => {
      if (!statChanges || statChanges.length === 0) return;
      if (attackerIsPlayer) {
        setE((cur) => {
          const stages = { ...(cur as any).stages || { attack:0, defense:0, specialAttack:0, specialDefense:0, speed:0 } };
          statChanges.forEach((sc: any) => {
            const statKeyMap: Record<string,string> = { "attack":"attack", "defense":"defense", "special-attack":"specialAttack", "special-defense":"specialDefense", "speed":"speed" };
            const key = statKeyMap[sc.stat] ?? sc.stat;
            const change = sc.change || 0;
            stages[key] = Math.max(-6, Math.min(6, (stages[key] || 0) + change));
            pushLog(`${mvName} ${change>0 ? "raised" : "lowered"} target ${key} by ${Math.abs(change)} stage(s).`);
          });
          return { ...cur, stages };
        });
      } else {
        setP((cur) => {
          const stages = { ...(cur as any).stages || { attack:0, defense:0, specialAttack:0, specialDefense:0, speed:0 } };
          statChanges.forEach((sc: any) => {
            const statKeyMap: Record<string,string> = { "attack":"attack", "defense":"defense", "special-attack":"specialAttack", "special-defense":"specialDefense", "speed":"speed" };
            const key = statKeyMap[sc.stat] ?? sc.stat;
            const change = sc.change || 0;
            stages[key] = Math.max(-6, Math.min(6, (stages[key] || 0) + change));
            pushLog(`${mvName} ${change>0 ? "raised" : "lowered"} your ${key} by ${Math.abs(change)} stage(s).`);
          });
          const updated = { ...cur, stages };
          try { onPlayerUpdate(updated); } catch {}
          return updated;
        });
      }
    };

    const applyStatus = (attackerIsPlayer: boolean, statusType: StatusType, moveName: string, accuracy: number) => {
      const hit = (Math.random() * 100) < accuracy;
      if (!hit) {
        pushLog(`${attackerIsPlayer ? p.name : e.name} used ${moveName} but it missed!`);
        return;
      }
      if (attackerIsPlayer) {
        const defenderTypes = e.types ?? ["normal"];
        if (isImmuneToStatus(defenderTypes, statusType, moveName)) {
          pushLog(`It doesn't affect ${e.name}...`);
          return;
        }
        const curStatus = (e as PokemonInstance).status;
        if (statusType !== "leech" && (curStatus === "paralysis" || curStatus === "poison" || curStatus === "sleep")) {
          pushLog(`${e.name} is already affected!`);
          return;
        }
        if (statusType === "leech") {
          setE((cur) => ({ ...cur, leechSeed: true }));
          pushLog(`${e.name} was seeded!`);
          return;
        }
        const sleepTurns = statusType === "sleep" ? 1 + Math.floor(Math.random() * 3) : undefined;
        setE((cur) => ({ ...cur, status: statusType, sleepTurnsLeft: sleepTurns }));
        pushLog(`${e.name} was ${statusType === "paralysis" ? "paralyzed" : statusType === "poison" ? "poisoned" : "put to sleep"}!`);
      } else {
        const defenderTypes = p.types ?? ["normal"];
        if (isImmuneToStatus(defenderTypes, statusType, moveName)) {
          pushLog(`It doesn't affect ${p.name}...`);
          return;
        }
        const curStatusP = (p as PokemonInstance).status;
        if (statusType !== "leech" && (curStatusP === "paralysis" || curStatusP === "poison" || curStatusP === "sleep")) {
          pushLog(`${p.name} is already affected!`);
          return;
        }
        if (statusType === "leech") {
          setP((cur) => {
            const updated = { ...cur, leechSeed: true };
            try { onPlayerUpdate(updated); } catch {}
            return updated;
          });
          pushLog(`${p.name} was seeded!`);
          return;
        }
        const sleepTurns = statusType === "sleep" ? 1 + Math.floor(Math.random() * 3) : undefined;
        setP((cur) => {
          const updated = { ...cur, status: statusType, sleepTurnsLeft: sleepTurns };
          try { onPlayerUpdate(updated); } catch {}
          return updated;
        });
        pushLog(`${p.name} was ${statusType === "paralysis" ? "paralyzed" : statusType === "poison" ? "poisoned" : "put to sleep"}!`);
      }
    };
    // First attack
      if (attackerFirst === "player") {
      if (playerStillAsleepRef.current) {
        pushLog(`${p.name} is fast asleep.`);
      } else if (p.status === "paralysis" && Math.random() < 0.25) {
        pushLog(`${p.name} is paralyzed! It can't move!`);
      } else {
        const statusEffect = getMoveStatusEffect(playerMove.name);
        const acc = playerMove.accuracy ?? statusEffect?.accuracy ?? 100;
        const hit = acc === null ? true : (Math.random() * 100) < acc;
        if (hit) {
          if (statusEffect) {
            applyStatus(true, statusEffect.status, playerMove.name, (acc ?? statusEffect.accuracy) ?? 100);
          } else if (playerMove.damage_class === "status") {
            applyStatChanges(true, playerMove.stat_changes ?? [], playerMove.name);
          } else {
            applyAttack(true, playerMove.power ?? 40, playerMove.name, playerMove.damage_class ?? "physical", playerMove.type, e.types);
          }
        } else pushLog(`${p.name} used ${playerMove.name} but it missed!`);
      }
    } else {
      const enemyMoveName = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
      let enemyMove: any = { name: enemyMoveName ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
      if (enemyMoveName) {
        try {
          enemyMove = await getMoveData(enemyMoveName);
        } catch {
          enemyMove = { name: enemyMoveName, power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
        }
      }
      if (enemyStillAsleepRef.current) {
        pushLog(`${e.name} is fast asleep.`);
      } else if (e.status === "paralysis" && Math.random() < 0.25) {
        pushLog(`${e.name} is paralyzed! It can't move!`);
      } else {
        const statusEffectE = getMoveStatusEffect(enemyMove.name);
        const accE = enemyMove.accuracy ?? statusEffectE?.accuracy ?? 100;
        const enemyHit = accE === null ? true : (Math.random() * 100) < accE;
        if (enemyHit) {
          if (statusEffectE) {
            applyStatus(false, statusEffectE.status, enemyMove.name, (accE ?? statusEffectE.accuracy) ?? 100);
          } else if (enemyMove.damage_class === "status") {
            applyStatChanges(false, enemyMove.stat_changes ?? [], enemyMove.name);
          } else {
            applyAttack(false, enemyMove.power ?? 35, enemyMove.name, enemyMove.damage_class ?? "physical", enemyMove.type, p.types);
          }
        } else pushLog(`${e.name} used ${enemyMove.name} but it missed!`);
      }
    }

    // wait a bit then second attack if still alive (use refs: state e/p are stale in closure)
    await sleep(900);
    const enemyAlive = attackerFirst === "player" ? enemyHpAfterFirstAttackRef.current > 0 : (e.hp > 0);
    const playerAlive = attackerFirst === "enemy" ? playerHpAfterFirstAttackRef.current > 0 : (p.hp > 0);
    // read latest p and e via closures - use state values
    let latestP = p;
    let latestE = e;
    // perform second attack only if defender did not faint
    if (attackerFirst === "player") {
      if (enemyHpAfterFirstAttackRef.current > 0) {
        if (enemyStillAsleepRef.current) {
          pushLog(`${e.name} is fast asleep.`);
        } else if (e.status === "paralysis" && Math.random() < 0.25) {
          pushLog(`${e.name} is paralyzed! It can't move!`);
        } else {
          const enemyMoveName2 = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
          let enemyMove2: any = { name: enemyMoveName2 ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
          if (enemyMoveName2) {
            try {
              enemyMove2 = await getMoveData(enemyMoveName2);
            } catch {
              enemyMove2 = { name: enemyMoveName2, power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
            }
          }
          const statusEffectE2 = getMoveStatusEffect(enemyMove2.name);
          const accE2 = enemyMove2.accuracy ?? statusEffectE2?.accuracy ?? 100;
          const enemyHit2 = accE2 === null ? true : (Math.random() * 100) < accE2;
          if (enemyHit2) {
            if (statusEffectE2) {
              applyStatus(false, statusEffectE2.status, enemyMove2.name, (accE2 ?? statusEffectE2.accuracy) ?? 100);
            } else if (enemyMove2.damage_class === "status") {
              applyStatChanges(false, enemyMove2.stat_changes ?? [], enemyMove2.name);
            } else {
              applyAttack(false, enemyMove2.power ?? 35, enemyMove2.name, enemyMove2.damage_class ?? "physical", enemyMove2.type, p.types);
            }
          } else pushLog(`${e.name} used ${enemyMove2.name} but it missed!`);
        }
      }
    } else {
      if (playerHpAfterFirstAttackRef.current > 0) {
        if (playerStillAsleepRef.current) {
          pushLog(`${p.name} is fast asleep.`);
        } else if (p.status === "paralysis" && Math.random() < 0.25) {
          pushLog(`${p.name} is paralyzed! It can't move!`);
        } else {
          const statusEffect2 = getMoveStatusEffect(playerMove.name);
          const acc2 = playerMove.accuracy ?? statusEffect2?.accuracy ?? 100;
          const hit2 = acc2 === null ? true : (Math.random() * 100) < acc2;
          if (hit2) {
            if (statusEffect2) {
              applyStatus(true, statusEffect2.status, playerMove.name, (acc2 ?? statusEffect2?.accuracy) ?? 100);
            } else if (playerMove.damage_class === "status") {
              applyStatChanges(true, playerMove.stat_changes ?? [], playerMove.name);
            } else {
              applyAttack(true, playerMove.power ?? 40, playerMove.name, playerMove.damage_class ?? "physical", playerMove.type, e.types);
            }
          } else pushLog(`${p.name} used ${playerMove.name} but it missed!`);
        }
      }
    }

    // Struggle recoil: player takes 1/4 max HP
    if (isStruggle) {
      setP((cur) => {
        const recoil = Math.max(1, Math.floor((cur.maxHp ?? 10) / 4));
        pushLog(`${cur.name} is damaged by recoil!`);
        const updated = { ...cur, hp: Math.max(0, cur.hp - recoil) };
        try { onPlayerUpdate(updated); } catch {}
        return updated;
      });
    }

    // End of turn: poison (1/16 max HP) and leech seed drain (Gen 1)
    setE((cur) => {
      const poisonDmg = cur.status === "poison" ? Math.max(1, Math.floor((cur.maxHp ?? 10) / 16)) : 0;
      const leechDmg = cur.leechSeed ? Math.max(1, Math.floor((cur.maxHp ?? 10) / 16)) : 0;
      enemyLeechDrainRef.current = leechDmg;
      if (poisonDmg > 0) pushLog(`${cur.name} is hurt by poison!`);
      if (leechDmg > 0) pushLog(`Leech seed drains ${cur.name}!`);
      return { ...cur, hp: Math.max(0, cur.hp - poisonDmg - leechDmg) };
    });
    setP((cur) => {
      const poisonDmg = cur.status === "poison" ? Math.max(1, Math.floor((cur.maxHp ?? 10) / 16)) : 0;
      const leechDmg = cur.leechSeed ? Math.max(1, Math.floor((cur.maxHp ?? 10) / 16)) : 0;
      playerLeechDrainRef.current = leechDmg;
      const healFromEnemy = enemyLeechDrainRef.current;
      if (poisonDmg > 0) pushLog(`${cur.name} is hurt by poison!`);
      if (leechDmg > 0) pushLog(`Leech seed drains ${cur.name}!`);
      if (healFromEnemy > 0) pushLog(`${cur.name} absorbed health from the leech seed!`);
      return { ...cur, hp: Math.min(cur.maxHp ?? 10, Math.max(0, cur.hp - poisonDmg - leechDmg) + healFromEnemy) };
    });

    // wait and check for faint
    await sleep(900);
    // read final states
    let finalP: PokemonInstance | null = null;
    let finalE: PokemonInstance | null = null;
    setP((curP) => { finalP = curP; return curP; });
    setE((curE) => { finalE = curE; return curE; });
    await new Promise((r) => setTimeout(r, 50));

    const curP = (finalP !== null ? finalP : playerPokemon) as PokemonInstance;
    const curE = (finalE !== null ? finalE : enemyPokemon) as PokemonInstance;
    const curPHp: number = getHp(curP);
    const curEHp: number = getHp(curE);
    if ((finalE !== null && getHp(finalE) <= 0) || curEHp <= 0) {
      setFaintAnim("enemy");
      await sleep(650);
      pushLog(`${curE.name} fainted!`);
      const xpGain = (isPvP && !isTrainerBattle) ? undefined : xpForDefeatingEnemy(curE.level ?? 1);
      setBusy(false);
      const participantIds = (isPvP && !isTrainerBattle) ? undefined : Array.from(participantIdsRef.current);
      if (isPvP && !isTrainerBattle) {
        onEnd({ winner: "player", xpGain, participantIds, playerFinalHp: curPHp, enemyFinalHp: Math.max(0, curEHp) });
      } else {
        pushLog("You win!");
        const xp = xpGain ?? 0;
        const ids = participantIds ?? [];
        if (xp > 0 && (playerTeam ?? []).length > 0) {
          (playerTeam ?? []).filter((m) => ids.includes(m.id)).forEach((m) => pushLog(`${m.name} gained ${xp} XP`));
        }
        const result: BattleEndResult = { winner: "player", xpGain: xp, participantIds: ids, playerFinalHp: curPHp, enemyFinalHp: Math.max(0, curEHp) };
        setTimeout(() => onEnd(result), VICTORY_CLOSE_MS);
      }
      return;
    }

    if ((finalP !== null && getHp(finalP) <= 0) || curPHp <= 0) {
      setFaintAnim("player");
      await sleep(650);
      pushLog(`${curP.name} fainted!`);
      try { onPlayerUpdate(curP); } catch {}
      setBusy(false);
      const canSwitch = playerTeam && onSwitchPokemon && playerTeam.some((m) => m.hp > 0 && m.id !== curP.id);
      if (canSwitch) {
        setFaintedLeadId(curP.id);
        setShowSwitchPicker(true);
        return;
      }
      onEnd({ winner: "enemy", ...(isPvP && { playerFinalHp: Math.max(0, curPHp), enemyFinalHp: curEHp }) });
      return;
    }

    setBusy(false);
  };

  const runAttemptsRef = useRef(0);

  const useItemInBattle = async (type: "potion" | "superpotion") => {
    if (busy) return;
    setBusy(true);
    const heal = type === "superpotion" ? 50 : 20;
    setP((cur) => {
      const newHp = Math.min(cur.maxHp, cur.hp + heal);
      pushLog(`Used ${type === "superpotion" ? "Super Potion" : "Potion"}! ${cur.name} recovered ${newHp - cur.hp} HP.`);
      const updated = { ...cur, hp: newHp };
      try { onPlayerUpdate(updated); } catch {}
      return updated;
    });
    onUsePotion?.(type);
    await sleep(600);
    if (!(e.status === "sleep") && !(e.status === "paralysis" && Math.random() < 0.25)) {
      const enemyMoveName = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
      let enemyMove: any = { name: enemyMoveName ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
      if (enemyMoveName) { try { enemyMove = await getMoveData(enemyMoveName); } catch {} }
      if (enemyMove.damage_class !== "status" && enemyMove.power) {
        const atkStat = e.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defStat = p.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defenderTy = p.types ?? ["normal"];
        const res = calculateDamageWithTypes(atkStat as any, defStat as any, enemyMove.power ?? 35, enemyMove.damage_class ?? "physical", e.level ?? 5, enemyMove.type, defenderTy, e.types);
        setShakeTarget("player");
        setTimeout(() => setShakeTarget(null), 350);
        setP((cur) => {
          const newHp = Math.max(0, cur.hp - res.damage);
          pushLog(`${e.name} used ${enemyMove.name} and dealt ${res.damage}.`);
          const updated = { ...cur, hp: newHp };
          try { onPlayerUpdate(updated); } catch {}
          return updated;
        });
      } else {
        pushLog(`${e.name} used ${enemyMove.name}!`);
      }
    }
    await sleep(500);
    setBusy(false);
  };

  const run = () => {
    if (isPvP || isTrainerBattle) {
      pushLog("You forfeited!");
      try { onPlayerUpdate(p); } catch {}
      onEnd({ winner: "run", ...(isPvP && { playerFinalHp: p.hp, enemyFinalHp: e.hp }) });
      return;
    }
    runAttemptsRef.current += 1;
    const pSpeed = p.stats?.speed ?? 5;
    const eSpeed = e.stats?.speed ?? 5;
    const escapeChance = Math.min(1, (pSpeed * 128 / Math.max(1, eSpeed) + 30 * runAttemptsRef.current) / 256);
    if (Math.random() < escapeChance) {
      pushLog("You ran away!");
      try { onPlayerUpdate(p); } catch {}
      onEnd({ winner: "run" });
    } else {
      pushLog("Can't escape!");
    }
  };

  const hpColor = (cur: number, max: number) => {
    const pct = cur / max;
    if (pct > 0.6) return "bg-green-400";
    if (pct > 0.3) return "bg-yellow-400";
    return "bg-red-500";
  };

  const switchOptions = (playerTeam ?? [])
    .map((m, i) => ({ mon: m, teamIndex: i }))
    .filter(({ mon }) => mon.hp > 0 && mon.id !== p.id);

  const isPvPMode = isPvP && pvpBattleState != null;
  const displayP = isPvPMode ? playerPokemon : p;
  const displayE = isPvPMode ? enemyPokemon : e;
  const displayLog = isPvPMode && pvpBattleState?.log ? pvpBattleState.log : log;
  const pvpEnded = isPvPMode && pvpBattleState?.status === "ended";
  const pvpWaiting = isPvPMode && pvpBattleState?.status === "waiting_moves";
  const pvpSwitchNeeded = isPvPMode && pvpBattleState?.status === "waiting_switch" && pvpBattleState.mustSwitch;
  const pvpMyMoveSubmitted = pvpBattleState?.myMoveSubmitted === true;

  if (isPvPMode && pvpEnded) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col modal-backdrop overflow-y-auto p-2 sm:p-4 safe-area-bottom">
        <div className="card-panel w-full max-w-2xl mx-auto p-6 text-white flex flex-col items-center justify-center border-2 border-amber-500/30">
          <div className="text-2xl font-bold mb-4">{pvpYouWon ? "You win!" : "You lose!"}</div>
          <div className="mb-4 space-y-1 text-sm text-gray-300">
            {displayLog.slice(-5).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
          <button type="button" className="pixel-btn pixel-btn-primary" onClick={() => onEnd({ winner: pvpYouWon ? "player" : "enemy", playerFinalHp: displayP.hp, enemyFinalHp: displayE.hp })}>Close</button>
        </div>
      </div>
    );
  }

  const bgClass = BATTLE_BG[locationType ?? ""] ?? "battle-bg-town";

  return (
    <div className="fixed inset-0 z-50 flex flex-col modal-backdrop overflow-y-auto p-2 sm:p-4 safe-area-bottom">
      <div className={`card-panel w-full max-w-2xl mx-auto p-3 sm:p-4 text-white flex-1 min-h-0 flex flex-col border-2 border-amber-500/30 ${bgClass}`}>
        {(showSwitchPicker || showVoluntarySwitch || pvpSwitchNeeded) ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="text-sm sm:text-base font-bold text-yellow-300 mb-2">
              {showSwitchPicker || pvpSwitchNeeded ? "Your Pokémon fainted. Choose another:" : "Switch Pokémon"}
            </div>
            {showVoluntarySwitch && (
              <button type="button" className="pixel-btn w-full mb-2 text-xs" onClick={() => setShowVoluntarySwitch(false)}>Back</button>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 flex-1 content-start">
              {switchOptions.map(({ mon, teamIndex }) => (
                <button
                  key={teamIndex}
                  className="flex items-center gap-2 p-2 rounded bg-gray-700 hover:bg-gray-600 pixel-btn text-left"
                  onClick={() => {
                    participantIdsRef.current.add(mon.id);
                    onSwitchPokemon?.(teamIndex);
                  }}
                >
                  <img src={mon.sprite} className="w-12 h-12 flex-shrink-0" alt={mon.name} />
                  <div className="min-w-0">
                    <div className="font-bold text-xs sm:text-sm truncate">{mon.name}</div>
                    <div className="text-[10px] sm:text-xs">Lv{mon.level} HP {mon.hp}/{mon.maxHp}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ) : (
        <>
        <div className="flex flex-col sm:flex-row sm:justify-between gap-3 sm:gap-4 flex-shrink-0">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="relative flex-shrink-0">
              <img
                src={displayP.sprite}
                alt={displayP.name}
                className={`w-16 h-16 sm:w-20 sm:h-20 ${battleEntered ? "battle-enter-player" : ""} ${shakeTarget === "player" ? "battle-shake" : ""} ${flashTarget === "player" ? "battle-flash" : ""} ${faintAnim === "player" ? "battle-faint" : ""}`}
              />
              {typeOverlay?.target === "player" && <div className={`type-overlay type-${typeOverlay.type}`} />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-sm text-gray-300">You</div>
              <div className="font-bold text-xs sm:text-base truncate">{displayP.name} Lv {displayP.level}</div>
              <div className="w-full max-w-40 h-2.5 sm:h-3 hp-bar bg-gray-700 mt-1">
                <div className={`hp-bar-fill ${hpColor(displayP.hp, displayP.maxHp)} h-2.5 sm:h-3`} style={{ width: `${Math.max(0, (displayP.hp / displayP.maxHp) * 100)}%` }} />
              </div>
              <div className="text-[10px] sm:text-xs mt-0.5">{displayP.hp}/{displayP.maxHp}</div>
              {!isPvPMode && (p.status || p.leechSeed) && (
                <div className="flex flex-wrap gap-1 mt-1" aria-label="Status">
                  {p.status === "paralysis" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-900/80 text-yellow-200">PAR</span>}
                  {p.status === "poison" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/80 text-purple-200">PSN</span>}
                  {p.status === "sleep" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/80 text-blue-200" title={`Sleep ${p.sleepTurnsLeft ?? 0} turn(s)`}>SLP</span>}
                  {p.leechSeed && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/80 text-green-200">SEED</span>}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 sm:justify-end">
            <div className="relative flex-shrink-0 order-2 sm:order-1">
              {captureAnim ? (
                <div className={`w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center ${captureAnim === "throw" ? "pokeball-throw" : captureAnim === "wobble" ? "pokeball-wobble" : captureAnim === "click" ? "pokeball-click" : "pokeball-escape"}`}>
                  <span className="text-3xl sm:text-4xl">🔴</span>
                </div>
              ) : (
                <img
                  src={displayE.sprite}
                  alt={displayE.name}
                  className={`w-16 h-16 sm:w-20 sm:h-20 ${battleEntered ? "battle-enter-enemy" : ""} ${shakeTarget === "enemy" ? "battle-shake" : ""} ${flashTarget === "enemy" ? "battle-flash" : ""} ${faintAnim === "enemy" ? "battle-faint" : ""}`}
                />
              )}
              {typeOverlay?.target === "enemy" && <div className={`type-overlay type-${typeOverlay.type}`} />}
            </div>
            <div className="min-w-0 flex-1 sm:text-right">
              <div className="text-xs sm:text-sm text-gray-300">Enemy</div>
              <div className="font-bold text-xs sm:text-base truncate">{displayE.name} Lv {displayE.level}</div>
              <div className="w-full max-w-40 h-2.5 sm:h-3 hp-bar bg-gray-700 mt-1 ml-auto sm:ml-0">
                <div className={`hp-bar-fill ${hpColor(displayE.hp, displayE.maxHp)} h-2.5 sm:h-3`} style={{ width: `${Math.max(0, (displayE.hp / displayE.maxHp) * 100)}%` }} />
              </div>
              <div className="text-[10px] sm:text-xs mt-0.5">{displayE.hp}/{displayE.maxHp}</div>
              {!isPvPMode && (e.status || e.leechSeed) && (
                <div className="flex flex-wrap gap-1 mt-1 justify-end" aria-label="Status">
                  {e.status === "paralysis" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-900/80 text-yellow-200">PAR</span>}
                  {e.status === "poison" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-900/80 text-purple-200">PSN</span>}
                  {e.status === "sleep" && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-900/80 text-blue-200" title={`Sleep ${e.sleepTurnsLeft ?? 0} turn(s)`}>SLP</span>}
                  {e.leechSeed && <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-green-900/80 text-green-200">SEED</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 sm:mt-4 flex-shrink-0">
          {pvpWaiting && pvpMyMoveSubmitted ? (
            <div className="p-3 rounded-lg bg-amber-900/30 border border-amber-600/50 text-center text-sm text-amber-200">Waiting for opponent...</div>
          ) : !showMoves ? (
            <div className={`grid gap-2 ${(isPvP || isTrainerBattle) ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-2"}`}>
              <button className="pixel-btn pixel-btn-primary w-full" onClick={() => setShowMoves(true)} disabled={busy || (pvpWaiting && pvpMyMoveSubmitted)}>⚔ Attack</button>
              {onSwitchPokemon && playerTeam && switchOptions.length > 0 && (
                <button className="pixel-btn w-full" onClick={() => setShowVoluntarySwitch(true)} disabled={busy || Boolean(pvpWaiting && pvpMyMoveSubmitted)}>Pokémon</button>
              )}
              <button className="pixel-btn w-full" onClick={run} disabled={busy}>{(isPvP || isTrainerBattle) ? "Forfeit" : "Run"}</button>
              {!(isPvP || isTrainerBattle) && onCapture && (
                <button
                  className="pixel-btn w-full col-span-2 sm:col-span-1"
                  onClick={async () => {
                    if (busy || pokeballCount < 1) return;
                    setBusy(true);
                    pushLog("Throwing Pokéball...");
                    setCaptureAnim("throw");
                    await sleep(550);
                    setCaptureAnim("wobble");
                    await sleep(1300);
                    try {
                      const ok = await Promise.resolve(onCapture());
                      if (Boolean(ok)) {
                        setCaptureAnim("click");
                        await sleep(400);
                        setCaptureAnim(null);
                        pushLog("Gotcha!");
                        try { onPlayerUpdate({ ...p, hp: p.hp }); } catch {}
                        const xpGain = xpForDefeatingEnemy(e.level ?? 1);
                        const ids = Array.from(participantIdsRef.current);
                        if (xpGain > 0 && (playerTeam ?? []).length > 0) {
                          (playerTeam ?? []).filter((m) => ids.includes(m.id)).forEach((m) => pushLog(`${m.name} gained ${xpGain} XP`));
                        }
                        const result: BattleEndResult = { winner: "player", xpGain, participantIds: ids };
                        setTimeout(() => onEnd(result), VICTORY_CLOSE_MS);
                      } else {
                        setCaptureAnim("escape");
                        await sleep(400);
                        setCaptureAnim(null);
                        pushLog("It broke free!");
                        await sleep(400);
                        const enemyMoveName2 = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
                        let enemyMove2: any = { name: enemyMoveName2 ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
                        if (enemyMoveName2) {
                          try {
                            enemyMove2 = await getMoveData(enemyMoveName2);
                          } catch {
                            enemyMove2 = { name: enemyMoveName2, power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
                          }
                        }
                        const enemyHit2 = (enemyMove2.accuracy ?? 100) === null ? true : (Math.random() * 100) < (enemyMove2.accuracy ?? 100);
                        if (enemyHit2) {
                          const atkBaseE = e.stats ?? { attack: 5, defense: 5, speed: 5 };
                          const defBaseP = p.stats ?? { attack: 5, defense: 5, speed: 5 };
                          const defenderTy = p.types ?? ["normal"];
                          const res = calculateDamageWithTypes(atkBaseE as any, defBaseP as any, enemyMove2.power ?? 35, enemyMove2.damage_class ?? "physical", e.level ?? 5, enemyMove2.type, defenderTy);
                          setP((cur) => {
                            const newHp = Math.max(0, cur.hp - res.damage);
                            pushLog(`${e.name} used ${enemyMove2.name} and dealt ${res.damage}.`);
                            return { ...cur, hp: newHp };
                          });
                        } else {
                          pushLog(`${e.name} used ${enemyMove2.name} but it missed!`);
                        }
                      }
                    } catch (err) {
                      console.error("capture error", err);
                      pushLog("Capture failed unexpectedly.");
                    } finally {
                      setBusy(false);
                    }
                  }}
                  disabled={busy || pokeballCount < 1}
                >
                  Capture ({pokeballCount})
                </button>
              )}
              {!isPvP && onUsePotion && (potionCount > 0 || superPotionCount > 0) && (
                <>
                  {potionCount > 0 && (
                    <button className="pixel-btn w-full text-xs" onClick={() => useItemInBattle("potion")} disabled={busy || p.hp >= p.maxHp}>
                      🧪 Potion ({potionCount})
                    </button>
                  )}
                  {superPotionCount > 0 && (
                    <button className="pixel-btn w-full text-xs" onClick={() => useItemInBattle("superpotion")} disabled={busy || p.hp >= p.maxHp}>
                      💊 S.Potion ({superPotionCount})
                    </button>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(() => {
                const moves = (displayP.moves ?? []).slice(0, 4);
                const allOutOfPP = moves.length > 0 && moves.every((m) => (ppMap[m] ?? 1) <= 0);
                if (allOutOfPP) {
                  return (
                    <button
                      key="struggle"
                      className="pixel-btn w-full col-span-2 border-red-500/60 text-red-300"
                      onClick={() => { doMove("struggle"); setShowMoves(false); }}
                      disabled={busy}
                    >
                      Struggle
                    </button>
                  );
                }
                return moves.map((m) => {
                  const remaining = ppMap[m] ?? "?";
                  const outOfPP = typeof remaining === "number" && remaining <= 0;
                  return (
                    <button
                      key={m}
                      className={`pixel-btn w-full ${outOfPP ? "opacity-40" : ""}`}
                      onClick={() => {
                        if (outOfPP) return;
                        if (isPvPMode && onPvpSubmitMove) {
                          onPvpSubmitMove(m);
                          setShowMoves(false);
                        } else {
                          doMove(m);
                          setShowMoves(false);
                        }
                      }}
                      disabled={busy || outOfPP}
                    >
                      <span className="block">{formatMoveName(m)}</span>
                      <span className="block text-[9px] text-gray-400">PP {remaining}</span>
                    </button>
                  );
                });
              })()}
              <button className="pixel-btn w-full" onClick={() => setShowMoves(false)} disabled={busy}>Back</button>
            </div>
          )}
        </div>

        <div className="mt-3 sm:mt-4 bg-black/40 p-3 rounded-lg border border-gray-600/50 flex-1 min-h-0 flex flex-col">
          <div className="text-xs font-bold text-amber-300/90 mb-2 flex-shrink-0">Battle Log</div>
          <div className="h-20 sm:h-28 overflow-y-auto text-[10px] sm:text-sm flex-1 min-h-0 space-y-1">
            {displayLog.map((l, i) => {
              let color = "";
              if (l.includes("super effective")) color = "text-red-400 font-bold";
              else if (l.includes("not very effective")) color = "text-gray-500";
              else if (l.includes("CRIT")) color = "text-yellow-300 font-bold";
              else if (l.includes("fainted")) color = "text-red-300";
              else if (l.includes("You win")) color = "text-green-300 font-bold";
              else if (l.includes("gained") && l.includes("XP")) color = "text-cyan-300";
              else if (l.includes("doesn't affect")) color = "text-gray-600";
              return (
                <div key={i} className={`break-words py-0.5 px-1 rounded odd:bg-gray-800/50 battle-log-entry ${color}`}>{l}</div>
              );
            })}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

