const TYPE_CHART = {
  normal: { ghost: 0 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, fairy: 2, steel: 0.5 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
};

const MOVE_MAP = {
  tackle: { power: 40, type: "normal", damageClass: "physical" },
  scratch: { power: 40, type: "normal", damageClass: "physical" },
  ember: { power: 40, type: "fire", damageClass: "special" },
  vinewhip: { power: 45, type: "grass", damageClass: "physical" },
  "vine-whip": { power: 45, type: "grass", damageClass: "physical" },
  watergun: { power: 40, type: "water", damageClass: "special" },
  "water-gun": { power: 40, type: "water", damageClass: "special" },
  growl: { power: 0, type: "normal", damageClass: "status" },
  tailwhip: { power: 0, type: "normal", damageClass: "status" },
  "tail-whip": { power: 0, type: "normal", damageClass: "status" },
  leer: { power: 0, type: "normal", damageClass: "status" },
  "leech-seed": { power: 0, type: "grass", damageClass: "status" },
  thunderbolt: { power: 90, type: "electric", damageClass: "special" },
  flamethrower: { power: 90, type: "fire", damageClass: "special" },
  surf: { power: 90, type: "water", damageClass: "special" },
  razorleaf: { power: 55, type: "grass", damageClass: "physical" },
  "razor-leaf": { power: 55, type: "grass", damageClass: "physical" },
};

export function normName(t) {
  return (t || "normal").toLowerCase().replace(/\s+/g, "").replace(/'/g, "").replace(/-/g, "");
}

export function getTypeMultiplier(moveType, defenderTypes) {
  const key = (t) => String(t || "normal").toLowerCase().replace(/[^a-z]/g, "");
  const atk = key(moveType);
  const defs = defenderTypes?.length ? defenderTypes.map(key) : ["normal"];
  let mult = 1;
  for (const d of defs) {
    mult *= TYPE_CHART[atk]?.[d] ?? 1;
  }
  return mult;
}

export function getMoveData(moveName) {
  const key = String(moveName || "").toLowerCase().replace(/\s+/g, "");
  const dashed = String(moveName || "").toLowerCase().replace(/\s+/g, "-");
  return MOVE_MAP[dashed] || MOVE_MAP[key] || MOVE_MAP[normName(moveName)] || { power: 40, type: "normal", damageClass: "physical" };
}

export function calculateDamage(attacker, defender, power, damageClass, attackerLevel, typeMultiplier, rng = Math.random) {
  if (!power || damageClass === "status") return { damage: 0, isCrit: false };
  const atkStat = damageClass === "special" ? (attacker.specialAttack ?? attacker.attack) : attacker.attack;
  const defStat = damageClass === "special" ? (defender.specialDefense ?? defender.defense) : defender.defense;
  const atk = Math.max(1, atkStat ?? 5);
  const def = Math.max(1, defStat ?? 5);
  const level = attackerLevel || 5;
  const base = (Math.floor((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2;
  const randomFactor = rng() * 0.15 + 0.85;
  const crit = rng() < 0.0625;
  const mod = randomFactor * (crit ? 1.5 : 1) * typeMultiplier;
  return { damage: Math.max(typeMultiplier === 0 ? 0 : 1, Math.floor(base * mod)), isCrit: crit };
}

export function calculateDamageWithTypes(attacker, defender, power, damageClass, attackerLevel, moveType, defenderTypes, attackerTypes, rng = Math.random) {
  const typeMultiplier = getTypeMultiplier(moveType, defenderTypes);
  const stab = (attackerTypes || []).some((t) => String(t).toLowerCase() === String(moveType).toLowerCase()) ? 1.5 : 1;
  const { damage, isCrit } = calculateDamage(attacker, defender, power, damageClass, attackerLevel, typeMultiplier * stab, rng);
  let effectiveness = "normal";
  if (typeMultiplier === 0) effectiveness = "immune";
  else if (typeMultiplier <= 0.5) effectiveness = "weak";
  else if (typeMultiplier >= 2) effectiveness = "super";
  return { damage, isCrit, effectiveness, typeMultiplier };
}

function firstHealthyIndex(team) {
  return (team || []).findIndex((m) => (m.hp ?? 0) > 0);
}

function applyMove(attackerMon, defenderMon, moveName, rng) {
  const move = getMoveData(moveName);
  const atkStats = attackerMon.stats || { attack: 5, defense: 5, speed: 5, specialAttack: 5, specialDefense: 5 };
  const defStats = defenderMon.stats || { attack: 5, defense: 5, speed: 5, specialAttack: 5, specialDefense: 5 };
  const result = calculateDamageWithTypes(
    atkStats,
    defStats,
    move.power,
    move.damageClass,
    attackerMon.level || 5,
    move.type,
    defenderMon.types || ["normal"],
    attackerMon.types || [],
    rng
  );
  const hp = Math.max(0, (defenderMon.hp ?? defenderMon.maxHp ?? 20) - result.damage);
  const lines = [];
  if (move.damageClass === "status" || move.power === 0) {
    lines.push(`${attackerMon.name} used ${moveName}!`);
  } else {
    let line = `${attackerMon.name} used ${moveName} and dealt ${result.damage}.`;
    if (result.isCrit) line += " A critical hit!";
    if (result.effectiveness === "super") line += " It's super effective!";
    if (result.effectiveness === "weak") line += " It's not very effective...";
    if (result.effectiveness === "immune") line += " It doesn't affect the foe...";
    lines.push(line);
  }
  return { hp, lines, fainted: hp <= 0 };
}

function snapshotHp(pvp, challenger, defender) {
  const cIdx = pvp.challengerIndex ?? 0;
  const dIdx = pvp.defenderIndex ?? 0;
  pvp.challengerHp = challenger.team[cIdx]?.hp ?? 0;
  pvp.defenderHp = defender.team[dIdx]?.hp ?? 0;
  pvp.challengerMaxHp = challenger.team[cIdx]?.maxHp ?? 20;
  pvp.defenderMaxHp = defender.team[dIdx]?.maxHp ?? 20;
}

function maybeEndOrForceSwitch(pvp, challenger, defender, log) {
  const cIdx = pvp.challengerIndex ?? 0;
  const dIdx = pvp.defenderIndex ?? 0;
  const cFaint = (challenger.team[cIdx]?.hp ?? 0) <= 0;
  const dFaint = (defender.team[dIdx]?.hp ?? 0) <= 0;
  const cHas = firstHealthyIndex(challenger.team);
  const dHas = firstHealthyIndex(defender.team);
  if (cFaint && cHas < 0) {
    pvp.status = "ended";
    pvp.winner = "defender";
    log.push(`${challenger.name} has no Pokémon left!`);
    return;
  }
  if (dFaint && dHas < 0) {
    pvp.status = "ended";
    pvp.winner = "challenger";
    log.push(`${defender.name} has no Pokémon left!`);
    return;
  }
  pvp.mustSwitch = null;
  if (cFaint) pvp.mustSwitch = "challenger";
  else if (dFaint) pvp.mustSwitch = "defender";
  pvp.status = pvp.mustSwitch ? "waiting_switch" : "waiting_moves";
}

export function resolvePvpTurn(state, rng = Math.random) {
  const pvp = state.pvpBattle;
  if (!pvp) return;
  const challenger = state.players.find((p) => p.id === pvp.challengerId);
  const defender = state.players.find((p) => p.id === pvp.defenderId);
  if (!challenger?.team?.length || !defender?.team?.length) return;

  if (pvp.status === "waiting_switch") {
    return;
  }

  if (pvp.status !== "waiting_moves" || pvp.challengerMove == null || pvp.defenderMove == null) return;

  const cIdx = pvp.challengerIndex ?? 0;
  const dIdx = pvp.defenderIndex ?? 0;
  const log = pvp.log || [];

  const cSwitch = typeof pvp.challengerMove === "object" && pvp.challengerMove.kind === "switch";
  const dSwitch = typeof pvp.defenderMove === "object" && pvp.defenderMove.kind === "switch";

  if (cSwitch) {
    const idx = pvp.challengerMove.index;
    if (challenger.team[idx] && (challenger.team[idx].hp ?? 0) > 0) {
      pvp.challengerIndex = idx;
      log.push(`${challenger.name} sent out ${challenger.team[idx].name}!`);
    }
  }
  if (dSwitch) {
    const idx = pvp.defenderMove.index;
    if (defender.team[idx] && (defender.team[idx].hp ?? 0) > 0) {
      pvp.defenderIndex = idx;
      log.push(`${defender.name} sent out ${defender.team[idx].name}!`);
    }
  }

  const cLead = challenger.team[pvp.challengerIndex ?? 0];
  const dLead = defender.team[pvp.defenderIndex ?? 0];
  const cSpeed = cLead.stats?.speed ?? 5;
  const dSpeed = dLead.stats?.speed ?? 5;
  const first = cSpeed === dSpeed ? (rng() < 0.5 ? "challenger" : "defender") : cSpeed > dSpeed ? "challenger" : "defender";

  const act = (who) => {
    const isC = who === "challenger";
    const action = isC ? pvp.challengerMove : pvp.defenderMove;
    if (typeof action === "object" && action.kind === "switch") return;
    const moveName = typeof action === "string" ? action : action?.moveName;
    if (!moveName) return;
    const atkTeam = isC ? challenger : defender;
    const defTeam = isC ? defender : challenger;
    const atkIdx = isC ? (pvp.challengerIndex ?? 0) : (pvp.defenderIndex ?? 0);
    const defIdx = isC ? (pvp.defenderIndex ?? 0) : (pvp.challengerIndex ?? 0);
    if ((atkTeam.team[atkIdx]?.hp ?? 0) <= 0 || (defTeam.team[defIdx]?.hp ?? 0) <= 0) return;
    const applied = applyMove(atkTeam.team[atkIdx], defTeam.team[defIdx], moveName, rng);
    defTeam.team[defIdx].hp = applied.hp;
    log.push(...applied.lines);
    if (applied.fainted) log.push(`${defTeam.team[defIdx].name} fainted!`);
  };

  if (first === "challenger") {
    act("challenger");
    act("defender");
  } else {
    act("defender");
    act("challenger");
  }

  pvp.log = log.slice(-16);
  pvp.challengerMove = null;
  pvp.defenderMove = null;
  snapshotHp(pvp, challenger, defender);
  maybeEndOrForceSwitch(pvp, challenger, defender, log);
}

export function applyForcedSwitch(state, playerId, index) {
  const pvp = state.pvpBattle;
  if (!pvp || pvp.status !== "waiting_switch") return false;
  const isC = playerId === pvp.challengerId;
  if (pvp.mustSwitch === "challenger" && !isC) return false;
  if (pvp.mustSwitch === "defender" && isC) return false;
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.team?.[index] || (player.team[index].hp ?? 0) <= 0) return false;
  if (isC) pvp.challengerIndex = index;
  else pvp.defenderIndex = index;
  pvp.log = [...(pvp.log || []), `${player.name} sent out ${player.team[index].name}!`].slice(-16);
  const challenger = state.players.find((p) => p.id === pvp.challengerId);
  const defender = state.players.find((p) => p.id === pvp.defenderId);
  snapshotHp(pvp, challenger, defender);
  pvp.mustSwitch = null;
  pvp.status = "waiting_moves";
  return true;
}

export { TYPE_CHART, MOVE_MAP };
