export type SimpleStats = {
  attack: number;
  defense: number;
  speed: number;
  specialAttack?: number;
  specialDefense?: number;
};

/** Type effectiveness: attack type vs defense type. 2 = super, 0.5 = not very, 0 = immune. Omitted = 1. */
const TYPE_CHART: Record<string, Record<string, number>> = {
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

export type TypeEffectiveness = "immune" | "weak" | "normal" | "super";

/** Returns damage multiplier and effectiveness label. Defender can have 1 or 2 types; multipliers stack. */
export function getTypeEffectiveness(
  moveType: string,
  defenderTypes: string[]
): { multiplier: number; effectiveness: TypeEffectiveness } {
  const norm = (t: string) => (t || "normal").toLowerCase().replace(/\s+/g, "-");
  const atk = norm(moveType);
  const defs = defenderTypes.length ? defenderTypes.map(norm) : ["normal"];
  let mult = 1;
  for (const d of defs) {
    const m = TYPE_CHART[atk]?.[d] ?? 1;
    mult *= m;
  }
  if (mult === 0) return { multiplier: 0, effectiveness: "immune" };
  if (mult <= 0.5) return { multiplier: mult, effectiveness: "weak" };
  if (mult >= 2) return { multiplier: mult, effectiveness: "super" };
  return { multiplier: mult, effectiveness: "normal" };
}

export function calculateDamage(
  attacker: SimpleStats,
  defender: SimpleStats,
  power: number,
  damageClass: "physical" | "special" | string = "physical",
  attackerLevel = 5,
  typeMultiplier = 1
) {
  const atkStat = damageClass === "special" ? (attacker.specialAttack ?? attacker.attack) : attacker.attack;
  const defStat = damageClass === "special" ? (defender.specialDefense ?? defender.defense) : defender.defense;
  const level = attackerLevel ?? 5;
  const atk = atkStat;
  const def = Math.max(1, defStat);
  const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2;
  const randomFactor = Math.random() * 0.15 + 0.85;
  const crit = Math.random() < 0.0625;
  const mod = randomFactor * (crit ? 1.5 : 1) * typeMultiplier;
  const dmg = Math.max(typeMultiplier === 0 ? 0 : 1, Math.floor(base * mod));
  return { damage: dmg, isCrit: crit };
}

/** Same as calculateDamage but accepts moveType and defenderTypes to compute type effectiveness. */
export function calculateDamageWithTypes(
  attacker: SimpleStats,
  defender: SimpleStats,
  power: number,
  damageClass: "physical" | "special" | string,
  attackerLevel: number,
  moveType: string,
  defenderTypes: string[]
) {
  const { multiplier, effectiveness } = getTypeEffectiveness(moveType, defenderTypes);
  const { damage, isCrit } = calculateDamage(attacker, defender, power, damageClass, attackerLevel, multiplier);
  return { damage, isCrit, effectiveness };
}

export function whoGoesFirst(aSpeed: number, bSpeed: number) {
  if (aSpeed === bSpeed) return Math.random() < 0.5 ? "a" : "b";
  return aSpeed > bSpeed ? "a" : "b";
}
