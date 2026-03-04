import React, { useEffect, useState } from "react";
import { calculateDamage, calculateDamageWithTypes, whoGoesFirst } from "../engine/battle";
import { getMoveData, formatMoveName, xpForDefeatingEnemy } from "../api/pokeapi";

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
};

export type BattleEndResult = { winner: "player" | "enemy" | "run"; xpGain?: number; playerFinalHp?: number; enemyFinalHp?: number };

type Props = {
  playerPokemon: PokemonInstance;
  enemyPokemon: PokemonInstance;
  playerTeam?: PokemonInstance[];
  onEnd: (result: BattleEndResult) => void;
  onPlayerUpdate: (p: PokemonInstance) => void;
  onSwitchPokemon?: (teamIndex: number) => void;
  onCapture?: (guaranteed?: boolean) => void;
  onGrantXp?: (xp: number) => void;
  isPvP?: boolean;
  isTrainerBattle?: boolean;
};

export default function BattleModal({ playerPokemon, enemyPokemon, playerTeam, onEnd, onPlayerUpdate, onSwitchPokemon, onCapture, isPvP, isTrainerBattle }: Props) {
  const [p, setP] = useState<PokemonInstance>(() => ({ ...playerPokemon }));
  const [e, setE] = useState<PokemonInstance>(() => ({ ...enemyPokemon }));
  const [showMoves, setShowMoves] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSwitchPicker, setShowSwitchPicker] = useState(false);
  const [faintedLeadId, setFaintedLeadId] = useState<number | null>(null);

  // Do NOT sync from props after mount: parent's enemyPokemon always has full HP.
  // Resyncing would overwrite local battle damage and make the enemy "heal" on every parent re-render.

  // clear log only on initial mount
  useEffect(() => {
    setLog([]);
  }, []);

  // When parent switches lead after we chose another Pokémon, update local player state
  useEffect(() => {
    if (showSwitchPicker && faintedLeadId !== null && playerPokemon.id !== faintedLeadId) {
      setP({ ...playerPokemon });
      setShowSwitchPicker(false);
      setFaintedLeadId(null);
    }
  }, [showSwitchPicker, faintedLeadId, playerPokemon]);

  const pushLog = (line: string) =>
    setLog((l) => {
      if (l[0] === line) return l;
      return [line, ...l].slice(0, 8);
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const doMove = async (moveName?: string) => {
    if (busy) return;
    setBusy(true);
    // resolve player's move data
    let playerMove: any = { name: moveName ?? "Attack", power: 40, accuracy: 100, damage_class: "physical", type: "normal" };
    if (moveName) {
      try {
        playerMove = await getMoveData(moveName);
      } catch {
        playerMove = { name: moveName, power: 40, accuracy: 100, damage_class: "physical", type: "normal" };
      }
    }
    // determine order
    const first = whoGoesFirst(p.stats?.speed ?? 5, e.stats?.speed ?? 5);
    const attackerFirst = first === "a" ? "player" : "enemy";

    const effectivenessMsg = (eff: "immune" | "weak" | "normal" | "super") => {
      if (eff === "super") return " It's super effective!";
      if (eff === "weak") return " It's not very effective...";
      if (eff === "immune") return " It doesn't affect the target.";
      return "";
    };

    const applyAttack = (attackerIsPlayer: boolean, mvPower: number, mvName?: string, mvClass: string = "physical", moveType?: string, defenderTypes?: string[]) => {
      if (attackerIsPlayer) {
        const atkBase = p.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defBase = e.stats ?? { attack: 5, defense: 5, speed: 5 };
        const stageMult = (s: number) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
        const atkEff = { attack: Math.max(1, Math.floor((atkBase.attack ?? 5) * stageMult((p as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((atkBase.defense ?? 5) * stageMult((p as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((atkBase.speed ?? 5) * stageMult((p as any).stages?.speed ?? 0))), specialAttack: Math.max(1, Math.floor(((atkBase as any).specialAttack ?? 5) * stageMult((p as any).stages?.specialAttack ?? 0))) };
        const defEff = { attack: Math.max(1, Math.floor((defBase.attack ?? 5) * stageMult((e as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((defBase.defense ?? 5) * stageMult((e as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((defBase.speed ?? 5) * stageMult((e as any).stages?.speed ?? 0))), specialDefense: Math.max(1, Math.floor(((defBase as any).specialDefense ?? 5) * stageMult((e as any).stages?.specialDefense ?? 0))) };
        const defenderTy = defenderTypes ?? e.types ?? ["normal"];
        const res = (moveType != null && defenderTy.length)
          ? calculateDamageWithTypes(atkEff as any, defEff as any, mvPower, mvClass ?? "physical", p.level ?? 5, moveType, defenderTy)
          : { ...calculateDamage(atkEff as any, defEff as any, mvPower, mvClass ?? "physical", p.level ?? 5), effectiveness: "normal" as const };
        setE((cur) => {
          const newHp = Math.max(0, cur.hp - res.damage);
          pushLog(`${p.name} used ${mvName ?? "Attack"} and dealt ${res.damage}${res.isCrit ? " (CRIT)" : ""}.${effectivenessMsg(res.effectiveness)}`);
          return { ...cur, hp: newHp };
        });
      } else {
        const atkBaseE = e.stats ?? { attack: 5, defense: 5, speed: 5 };
        const defBaseP = p.stats ?? { attack: 5, defense: 5, speed: 5 };
        const stageMultE = (s: number) => (s >= 0 ? (2 + s) / 2 : 2 / (2 - s));
        const atkEffE = { attack: Math.max(1, Math.floor((atkBaseE.attack ?? 5) * stageMultE((e as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((atkBaseE.defense ?? 5) * stageMultE((e as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((atkBaseE.speed ?? 5) * stageMultE((e as any).stages?.speed ?? 0))), specialAttack: Math.max(1, Math.floor(((atkBaseE as any).specialAttack ?? 5) * stageMultE((e as any).stages?.specialAttack ?? 0))) };
        const defEffP = { attack: Math.max(1, Math.floor((defBaseP.attack ?? 5) * stageMultE((p as any).stages?.attack ?? 0))), defense: Math.max(1, Math.floor((defBaseP.defense ?? 5) * stageMultE((p as any).stages?.defense ?? 0))), speed: Math.max(1, Math.floor((defBaseP.speed ?? 5) * stageMultE((p as any).stages?.speed ?? 0))), specialDefense: Math.max(1, Math.floor(((defBaseP as any).specialDefense ?? 5) * stageMultE((p as any).stages?.specialDefense ?? 0))) };
        const defenderTy = defenderTypes ?? p.types ?? ["normal"];
        const res = (moveType != null && defenderTy.length)
          ? calculateDamageWithTypes(atkEffE as any, defEffP as any, mvPower, mvClass ?? "physical", e.level ?? 5, moveType, defenderTy)
          : { ...calculateDamage(atkEffE as any, defEffP as any, mvPower, mvClass ?? "physical", e.level ?? 5), effectiveness: "normal" as const };
        setP((cur) => {
          const newHp = Math.max(0, cur.hp - res.damage);
          const updated = { ...cur, hp: newHp };
          pushLog(`${e.name} used ${mvName ?? "Attack"} and dealt ${res.damage}${res.isCrit ? " (CRIT)" : ""}.${effectivenessMsg(res.effectiveness)}`);
          return updated;
        });
      }
    };

    const applyStatChanges = (attackerIsPlayer: boolean, statChanges: any[], mvName?: string) => {
      if (!statChanges || statChanges.length === 0) return;
      if (attackerIsPlayer) {
        // apply to enemy (e)
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
        // apply to player (p)
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
    // First attack
      if (attackerFirst === "player") {
      // accuracy check
      const hit = (playerMove.accuracy ?? 100) === null ? true : (Math.random() * 100) < (playerMove.accuracy ?? 100);
      if (hit) {
        if (playerMove.damage_class === "status") {
          applyStatChanges(true, playerMove.stat_changes ?? [], playerMove.name);
        } else {
          applyAttack(true, playerMove.power ?? 40, playerMove.name, playerMove.damage_class ?? "physical", playerMove.type, e.types);
        }
      } else pushLog(`${p.name} used ${playerMove.name} but it missed!`);
    } else {
      // enemy selects move
      const enemyMoveName = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
      let enemyMove: any = { name: enemyMoveName ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
      if (enemyMoveName) {
        try {
          enemyMove = await getMoveData(enemyMoveName);
        } catch {
          enemyMove = { name: enemyMoveName, power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
        }
      }
      const enemyHit = (enemyMove.accuracy ?? 100) === null ? true : (Math.random() * 100) < (enemyMove.accuracy ?? 100);
      if (enemyHit) {
        if (enemyMove.damage_class === "status") {
          applyStatChanges(false, enemyMove.stat_changes ?? [], enemyMove.name);
        } else {
          applyAttack(false, enemyMove.power ?? 35, enemyMove.name, enemyMove.damage_class ?? "physical", enemyMove.type, p.types);
        }
      } else pushLog(`${e.name} used ${enemyMove.name} but it missed!`);
    }

    // wait a bit then second attack if still alive
    await sleep(900);
    const enemyAlive = (e.hp > 0);
    const playerAlive = (p.hp > 0);
    // read latest p and e via closures - use state values
    let latestP = p;
    let latestE = e;
    // sync from states (they'll be updated shortly)
    // perform second attack
    if (attackerFirst === "player") {
      // enemy retaliates if alive - select enemy move
      if ((e.hp - 0) > 0) {
        const enemyMoveName = (e.moves && e.moves.length > 0) ? e.moves[Math.floor(Math.random() * e.moves.length)] : undefined;
        let enemyMove: any = { name: enemyMoveName ?? "Attack", power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
        if (enemyMoveName) {
          try {
            enemyMove = await getMoveData(enemyMoveName);
          } catch {
            enemyMove = { name: enemyMoveName, power: 35, accuracy: 100, damage_class: "physical", type: "normal" };
          }
        }
        const enemyHit = (enemyMove.accuracy ?? 100) === null ? true : (Math.random() * 100) < (enemyMove.accuracy ?? 100);
        if (enemyHit) applyAttack(false, enemyMove.power ?? 35, enemyMove.name, enemyMove.damage_class ?? "physical", enemyMove.type, p.types);
        else pushLog(`${e.name} used ${enemyMove.name} but it missed!`);
      }
    } else {
      // player retaliates if alive
      if ((p.hp - 0) > 0) {
        const playerHit = (playerMove.accuracy ?? 100) === null ? true : (Math.random() * 100) < (playerMove.accuracy ?? 100);
        if (playerHit) applyAttack(true, playerMove.power ?? 40, playerMove.name, playerMove.damage_class ?? "physical", playerMove.type, e.types);
        else pushLog(`${p.name} used ${playerMove.name} but it missed!`);
      }
    }

    // wait and check for faint
    await sleep(900);
    // read final states
    let finalP = null;
    let finalE = null;
    // Use functional gets
    setP((curP) => { finalP = curP; return curP; });
    setE((curE) => { finalE = curE; return curE; });
    // small delay to ensure states settled
    await new Promise((r) => setTimeout(r, 50));

    if ((finalE && finalE.hp <= 0) || (e.hp <= 0)) {
      pushLog(`${e.name} fainted!`);
      const xpGain = (isPvP && !isTrainerBattle) ? undefined : xpForDefeatingEnemy(e.level ?? 1);
      const playerHp = (finalP ?? p).hp;
      const enemyHp = (finalE ?? e).hp;
      setBusy(false);
      onEnd({ winner: "player", xpGain, ...(isPvP && { playerFinalHp: playerHp, enemyFinalHp: Math.max(0, enemyHp) }) });
      return;
    }

    if ((finalP && finalP.hp <= 0) || (p.hp <= 0)) {
      pushLog(`${p.name} fainted!`);
      try { onPlayerUpdate(finalP ?? p); } catch {}
      const playerHp = (finalP ?? p).hp;
      const enemyHp = (finalE ?? e).hp;
      setBusy(false);
      const canSwitch = playerTeam && onSwitchPokemon && playerTeam.some((m) => m.hp > 0 && m.id !== (finalP ?? p).id);
      if (canSwitch) {
        setFaintedLeadId((finalP ?? p).id);
        setShowSwitchPicker(true);
        return;
      }
      onEnd({ winner: "enemy", ...(isPvP && { playerFinalHp: Math.max(0, playerHp), enemyFinalHp: enemyHp }) });
      return;
    }

    setBusy(false);
  };

  const run = () => {
    pushLog((isPvP || isTrainerBattle) ? "You forfeited!" : "You ran away!");
    try { onPlayerUpdate(p); } catch {}
    onEnd({ winner: "run", ...(isPvP && { playerFinalHp: p.hp, enemyFinalHp: e.hp }) });
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col modal-backdrop overflow-y-auto p-2 sm:p-4 safe-area-bottom">
      <div className="card-panel w-full max-w-2xl mx-auto p-3 sm:p-4 text-white flex-1 min-h-0 flex flex-col border-2 border-amber-500/30">
        {showSwitchPicker ? (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="text-sm sm:text-base font-bold text-yellow-300 mb-2">Your Pokémon fainted. Choose another:</div>
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-2 flex-1 content-start">
              {switchOptions.map(({ mon, teamIndex }) => (
                <button
                  key={teamIndex}
                  className="flex items-center gap-2 p-2 rounded bg-gray-700 hover:bg-gray-600 pixel-btn text-left"
                  onClick={() => onSwitchPokemon?.(teamIndex)}
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
            <img src={p.sprite} alt={p.name} className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-sm text-gray-300">You</div>
              <div className="font-bold text-xs sm:text-base truncate">{p.name} Lv {p.level}</div>
              <div className="w-full max-w-40 h-2.5 sm:h-3 hp-bar bg-gray-700 mt-1">
                <div className={`hp-bar-fill ${hpColor(p.hp, p.maxHp)} h-2.5 sm:h-3`} style={{ width: `${Math.max(0, (p.hp / p.maxHp) * 100)}%` }} />
              </div>
              <div className="text-[10px] sm:text-xs mt-0.5">{p.hp}/{p.maxHp}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 sm:justify-end">
            <img src={e.sprite} alt={e.name} className="w-16 h-16 sm:w-20 sm:h-20 flex-shrink-0 order-2 sm:order-1" />
            <div className="min-w-0 flex-1 sm:text-right">
              <div className="text-xs sm:text-sm text-gray-300">Enemy</div>
              <div className="font-bold text-xs sm:text-base truncate">{e.name} Lv {e.level}</div>
              <div className="w-full max-w-40 h-2.5 sm:h-3 hp-bar bg-gray-700 mt-1 ml-auto sm:ml-0">
                <div className={`hp-bar-fill ${hpColor(e.hp, e.maxHp)} h-2.5 sm:h-3`} style={{ width: `${Math.max(0, (e.hp / e.maxHp) * 100)}%` }} />
              </div>
              <div className="text-[10px] sm:text-xs mt-0.5">{e.hp}/{e.maxHp}</div>
            </div>
          </div>
        </div>

        <div className="mt-3 sm:mt-4 flex-shrink-0">
          {!showMoves ? (
            <div className={`grid gap-2 ${(isPvP || isTrainerBattle) ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-2"}`}>
              <button className="pixel-btn pixel-btn-primary w-full" onClick={() => setShowMoves(true)} disabled={busy}>⚔ Attack</button>
              <button className="pixel-btn w-full" onClick={run} disabled={busy}>{(isPvP || isTrainerBattle) ? "Forfeit" : "Run"}</button>
              {!(isPvP || isTrainerBattle) && <button className="pixel-btn w-full col-span-2 sm:col-span-1" onClick={async () => {
                if (!onCapture) return;
                if (busy) return;
                setBusy(true);
                pushLog("Throwing Pokéball...");
                console.log("BattleModal: attempting normal capture");
                try {
                  const ok = await Promise.resolve(onCapture(false));
                  if (ok) {
                    pushLog("Gotcha!");
                    await sleep(700);
                    try { onPlayerUpdate({ ...p, hp: p.hp }); } catch {}
                    onEnd({ winner: "player" });
                  } else {
                    pushLog("It broke free!");
              // enemy gets a full attack turn after failed capture
              await sleep(400);
              // choose enemy move
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
                applyAttack(false, enemyMove2.power ?? 35, enemyMove2.name, enemyMove2.damage_class ?? "physical", enemyMove2.type, p.types);
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
              }} disabled={busy}>Capture</button>}
              {!(isPvP || isTrainerBattle) && <button className="pixel-btn w-full" onClick={async () => {
                if (!onCapture) return;
                if (busy) return;
                setBusy(true);
                pushLog("Throwing Ultra Ball...");
                try {
                  const ok = await Promise.resolve(onCapture(true));
                  if (ok) {
                    pushLog("Gotcha with Ultra Ball!");
                    await sleep(700);
                    try { onPlayerUpdate({ ...p, hp: p.hp }); } catch {}
                    onEnd({ winner: "player" });
                  } else {
                    pushLog("Ultra Ball failed!");
                  }
                } catch (err) {
                  console.error("ultraball error", err);
                  pushLog("Ultra Ball failed unexpectedly.");
                } finally {
                  setBusy(false);
                }
              }} disabled={busy}>Ultra Ball</button>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {(p.moves ?? []).slice(0,4).map((m) => (
                <button key={m} className="pixel-btn w-full" onClick={() => { doMove(m); setShowMoves(false); }} disabled={busy}>{formatMoveName(m)}</button>
              ))}
              <button className="pixel-btn w-full" onClick={() => setShowMoves(false)} disabled={busy}>Back</button>
            </div>
          )}
        </div>

        <div className="mt-3 sm:mt-4 bg-black/40 p-3 rounded-lg border border-gray-600/50 flex-1 min-h-0 flex flex-col">
          <div className="text-xs font-bold text-amber-300/90 mb-2 flex-shrink-0">Battle Log</div>
          <div className="h-20 sm:h-28 overflow-y-auto text-[10px] sm:text-sm flex-1 min-h-0 space-y-1">
            {log.map((l, i) => (
              <div key={i} className="break-words py-0.5 px-1 rounded odd:bg-gray-800/50">{l}</div>
            ))}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

