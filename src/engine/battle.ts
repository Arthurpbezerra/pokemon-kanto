export type SimpleStats = {
  attack: number;
  defense: number;
  speed: number;
  specialAttack?: number;
  specialDefense?: number;
};

export function calculateDamage(
  attacker: SimpleStats,
  defender: SimpleStats,
  power: number,
  damageClass: "physical" | "special" | string = "physical",
  attackerLevel = 5
) {
  // Choose attack/defense by damage class
  const atkStat = damageClass === "special" ? (attacker.specialAttack ?? attacker.attack) : attacker.attack;
  const defStat = damageClass === "special" ? (defender.specialDefense ?? defender.defense) : defender.defense;
  const level = attackerLevel ?? 5;
  const atk = atkStat;
  const def = Math.max(1, defStat);
  const base = (((2 * level) / 5 + 2) * power * (atk / def)) / 50 + 2;
  const randomFactor = Math.random() * 0.15 + 0.85; // 0.85 - 1.0
  const crit = Math.random() < 0.0625; // 6.25% critical
  const mod = randomFactor * (crit ? 1.5 : 1);
  const dmg = Math.max(1, Math.floor(base * mod));
  return { damage: dmg, isCrit: crit };
}

export function whoGoesFirst(aSpeed: number, bSpeed: number) {
  if (aSpeed === bSpeed) return Math.random() < 0.5 ? "a" : "b";
  return aSpeed > bSpeed ? "a" : "b";
}

