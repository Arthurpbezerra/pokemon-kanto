/** Minimal battle resolution for PvP (authoritative server). */

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
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 }
};

/** Common moves: name -> { power, type, damageClass } */
const MOVE_MAP = {
  tackle: { power: 35, type: "normal", damageClass: "physical" },
  scratch: { power: 40, type: "normal", damageClass: "physical" },
  ember: { power: 40, type: "fire", damageClass: "special" },
  vinewhip: { power: 45, type: "grass", damageClass: "physical" },
  watergun: { power: 40, type: "water", damageClass: "special" },
  thunderbolt: { power: 90, type: "electric", damageClass: "special" },
  quickattack: { power: 40, type: "normal", damageClass: "physical" },
  bite: { power: 60, type: "dark", damageClass: "physical" },
  headbutt: { power: 70, type: "normal", damageClass: "physical" },
  bodyslam: { power: 85, type: "normal", damageClass: "physical" },
  flamethrower: { power: 90, type: "fire", damageClass: "special" },
  surf: { power: 90, type: "water", damageClass: "special" },
  solarbeam: { power: 120, type: "grass", damageClass: "special" },
  earthquake: { power: 100, type: "ground", damageClass: "physical" },
  psychic: { power: 90, type: "psychic", damageClass: "special" },
  icebeam: { power: 90, type: "ice", damageClass: "special" },
  thunder: { power: 110, type: "electric", damageClass: "special" },
  fireblast: { power: 110, type: "fire", damageClass: "special" },
  blizzard: { power: 110, type: "ice", damageClass: "special" },
  hyperbeam: { power: 150, type: "normal", damageClass: "special" },
  slash: { power: 70, type: "normal", damageClass: "physical" },
  megapunch: { power: 80, type: "normal", damageClass: "physical" },
  megakick: { power: 120, type: "normal", damageClass: "physical" },
  tailwhip: { power: 0, type: "normal", damageClass: "status" },
  growl: { power: 0, type: "normal", damageClass: "status" },
  leer: { power: 0, type: "normal", damageClass: "status" },
  sandattack: { power: 0, type: "ground", damageClass: "status" },
  stringshot: { power: 0, type: "bug", damageClass: "status" }
};

function norm(t) {
  return (t || "normal").toLowerCase().replace(/\s+/g, "").replace(/'/g, "").replace(/-/g, "");
}

function getTypeMultiplier(moveType, defenderTypes) {
  const atk = norm(moveType);
  const defs = (defenderTypes && defenderTypes.length) ? defenderTypes.map(norm) : ["normal"];
  let mult = 1;
  for (const d of defs) {
    mult *= TYPE_CHART[atk]?.[d] ?? 1;
  }
  return mult;
}

function whoGoesFirst(aSpeed, bSpeed) {
  if (aSpeed === bSpeed) return Math.random() < 0.5 ? "challenger" : "defender";
  return aSpeed > bSpeed ? "challenger" : "defender";
}

function getMoveData(moveName) {
  const key = norm(moveName);
  return MOVE_MAP[key] || { power: 40, type: "normal", damageClass: "physical" };
}

function calculateDamage(attacker, defender, power, damageClass, attackerLevel, typeMultiplier) {
  if (power === 0 || damageClass === "status") return 0;
  const atkStat = damageClass === "special" ? (attacker.specialAttack ?? attacker.attack) : attacker.attack;
  const defStat = damageClass === "special" ? (defender.specialDefense ?? defender.defense) : defender.defense;
  const atk = Math.max(1, atkStat);
  const def = Math.max(1, defStat);
  const level = attackerLevel || 5;
  const base = (Math.floor((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2;
  const randomFactor = Math.random() * 0.15 + 0.85;
  const crit = Math.random() < 0.0625;
  const mod = randomFactor * (crit ? 1.5 : 1) * typeMultiplier;
  return Math.max(typeMultiplier === 0 ? 0 : 1, Math.floor(base * mod));
}

/**
 * Resolve one PvP turn. Mutates pvpBattle and state.players.
 * @param {Map} state - room state (players, pvpBattle)
 */
export function resolvePvpTurn(state) {
  const pvp = state.pvpBattle;
  if (!pvp || pvp.status !== "waiting_moves" || pvp.challengerMove == null || pvp.defenderMove == null) return;

  const challenger = state.players.find((p) => p.id === pvp.challengerId);
  const defender = state.players.find((p) => p.id === pvp.defenderId);
  if (!challenger?.team?.[0] || !defender?.team?.[0]) return;

  const cLead = challenger.team[0];
  const dLead = defender.team[0];
  const cStats = cLead.stats || { attack: 5, defense: 5, speed: 5, specialAttack: 5, specialDefense: 5 };
  const dStats = dLead.stats || { attack: 5, defense: 5, speed: 5, specialAttack: 5, specialDefense: 5 };
  const cTypes = cLead.types || ["normal"];
  const dTypes = dLead.types || ["normal"];
  const cLevel = cLead.level || 5;
  const dLevel = dLead.level || 5;

  const cMove = getMoveData(pvp.challengerMove);
  const dMove = getMoveData(pvp.defenderMove);

  let cHp = pvp.challengerHp ?? cLead.maxHp ?? cLead.hp;
  let dHp = pvp.defenderHp ?? dLead.maxHp ?? dLead.hp;

  const first = whoGoesFirst(cStats.speed ?? 5, dStats.speed ?? 5);
  const log = pvp.log || [];

  // First attack
  if (first === "challenger") {
    if (cMove.power > 0 && cMove.damageClass !== "status") {
      const mult = getTypeMultiplier(cMove.type, dTypes);
      const dmg = calculateDamage(cStats, dStats, cMove.power, cMove.damageClass, cLevel, mult);
      dHp = Math.max(0, dHp - dmg);
      log.push(`${cLead.name} used ${pvp.challengerMove} and dealt ${dmg} to ${dLead.name}.`);
    }
  } else {
    if (dMove.power > 0 && dMove.damageClass !== "status") {
      const mult = getTypeMultiplier(dMove.type, cTypes);
      const dmg = calculateDamage(dStats, cStats, dMove.power, dMove.damageClass, dLevel, mult);
      cHp = Math.max(0, cHp - dmg);
      log.push(`${dLead.name} used ${pvp.defenderMove} and dealt ${dmg} to ${cLead.name}.`);
    }
  }

  // Second attack (if target still alive)
  if (first === "challenger") {
    if (dHp > 0 && dMove.power > 0 && dMove.damageClass !== "status") {
      const mult = getTypeMultiplier(dMove.type, cTypes);
      const dmg = calculateDamage(dStats, cStats, dMove.power, dMove.damageClass, dLevel, mult);
      cHp = Math.max(0, cHp - dmg);
      log.push(`${dLead.name} used ${pvp.defenderMove} and dealt ${dmg} to ${cLead.name}.`);
    }
  } else {
    if (cHp > 0 && cMove.power > 0 && cMove.damageClass !== "status") {
      const mult = getTypeMultiplier(cMove.type, dTypes);
      const dmg = calculateDamage(cStats, dStats, cMove.power, cMove.damageClass, cLevel, mult);
      dHp = Math.max(0, dHp - dmg);
      log.push(`${cLead.name} used ${pvp.challengerMove} and dealt ${dmg} to ${dLead.name}.`);
    }
  }

  pvp.challengerHp = cHp;
  pvp.defenderHp = dHp;
  pvp.log = log.slice(-12);
  pvp.challengerMove = null;
  pvp.defenderMove = null;

  // Update state.players team[0].hp
  for (const p of state.players) {
    if (p.id === pvp.challengerId && p.team?.[0]) p.team[0].hp = cHp;
    if (p.id === pvp.defenderId && p.team?.[0]) p.team[0].hp = dHp;
  }

  if (cHp <= 0 || dHp <= 0) {
    pvp.status = "ended";
    pvp.winner = cHp <= 0 ? "defender" : "challenger";
    if (cHp <= 0) log.push(`${cLead.name} fainted!`);
    else log.push(`${dLead.name} fainted!`);
  } else {
    pvp.status = "waiting_moves";
  }
}
