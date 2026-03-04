type RawPokemon = {
  id: number;
  name: string;
  sprites: { front_default: string | null };
  stats: { base_stat: number; stat: { name: string } }[];
  moves: {
    move: { name: string };
    version_group_details: { level_learned_at: number; move_learn_method: { name: string }; version_group: { name: string } }[];
  }[];
};

type PokemonTemplate = {
  id: number;
  name: string;
  sprite: string;
  baseStats: { hp: number; attack: number; defense: number; speed: number; specialAttack: number; specialDefense: number };
  moves: {
    name: string;
    versionDetails: { level_learned_at: number; move_learn_method: { name: string }; version_group: { name: string } }[];
  }[];
};

const API_BASE = "https://pokeapi.co/api/v2";
const cache = new Map<number, PokemonTemplate>();
const moveCache = new Map<string, { name: string; power: number | null; accuracy: number | null; damage_class: string | null }>();

async function fetchRawPokemon(id: number): Promise<RawPokemon> {
  const res = await fetch(`${API_BASE}/pokemon/${id}`);
  if (!res.ok) throw new Error("Failed to fetch pokemon " + id);
  return (await res.json()) as RawPokemon;
}

export async function getPokemonTemplate(id: number): Promise<PokemonTemplate> {
  if (cache.has(id)) return cache.get(id)!;
  const raw = await fetchRawPokemon(id);
  const sprite = raw.sprites.front_default || `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;
  const stats: Record<string, number> = {};
  raw.stats.forEach((s) => {
    stats[s.stat.name] = s.base_stat;
  });
  const tpl: PokemonTemplate = {
    id: raw.id,
    name: raw.name[0].toUpperCase() + raw.name.slice(1),
    sprite,
    baseStats: {
      hp: stats["hp"] ?? 10,
      attack: stats["attack"] ?? 5,
      defense: stats["defense"] ?? 5,
      speed: stats["speed"] ?? 5,
      specialAttack: stats["special-attack"] ?? stats["special_attack"] ?? 5,
      specialDefense: stats["special-defense"] ?? stats["special_defense"] ?? 5
    },
    moves: raw.moves.map((m) => ({
      name: m.move.name,
      versionDetails: m.version_group_details || []
    }))
  };
  cache.set(id, tpl);
  return tpl;
}

// Simple XP: XP needed to reach next level; XP granted per defeated enemy level
export const xpToNextForLevel = (level: number) => 40 * level;
export const xpForDefeatingEnemy = (enemyLevel: number) => 12 * enemyLevel;

export function makeInstanceFromTemplate(tpl: PokemonTemplate, level = 5) {
  // Stats scale with level from base stats (no IV/EV). Simple formulas:
  // HP: (2*base*level)/100 + level + 10; others: (2*base*level)/100 + 5
  const calcHp = (base: number, lvl: number) => Math.max(1, Math.floor(((2 * base) * lvl) / 100) + lvl + 10);
  const calcStat = (base: number, lvl: number) => Math.max(1, Math.floor(((2 * base) * lvl) / 100) + 5);

  const maxHp = calcHp(tpl.baseStats.hp, level);
  const attack = calcStat(tpl.baseStats.attack, level);
  const defense = calcStat(tpl.baseStats.defense, level);
  const speed = calcStat(tpl.baseStats.speed, level);
  const specialAttack = calcStat(tpl.baseStats.specialAttack, level);
  const specialDefense = calcStat(tpl.baseStats.specialDefense, level);
  const selectedMoves = getMovesForLevel(tpl.moves, level);

  return {
    id: tpl.id,
    name: tpl.name,
    sprite: tpl.sprite,
    level,
    hp: maxHp,
    maxHp,
    stats: { attack, defense, speed, specialAttack, specialDefense },
    stages: { attack: 0, defense: 0, specialAttack: 0, specialDefense: 0, speed: 0 },
    xp: 0,
    xpToNext: xpToNextForLevel(level),
    moves: selectedMoves
  };
}

export function formatMoveName(name: string) {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function getMovesForLevel(
  apiMoves: { name: string; versionDetails: { level_learned_at: number; move_learn_method: { name: string }; version_group: { name: string } }[] }[],
  currentLevel: number
) {
  // Prefer red-blue version group, fallback to firered-leafgreen
  const preferred = "red-blue";
  const fallback = "firered-leafgreen";
  const movesWithLevels: { name: string; learnedAt: number }[] = [];

  for (const mv of apiMoves) {
    // find matching version details for preferred or fallback that are level-up
    const vgs = mv.versionDetails.filter((vd) => vd.move_learn_method?.name === "level-up" && vd.level_learned_at > 0);
    if (vgs.length === 0) continue;
    // try preferred
    let chosen = vgs.filter((vd) => vd.version_group?.name === preferred);
    if (chosen.length === 0) chosen = vgs.filter((vd) => vd.version_group?.name === fallback);
    if (chosen.length === 0) chosen = vgs; // last resort, any level-up entry
    // pick the entry with the highest level_learned_at (most recent)
    const best = chosen.reduce((a, b) => (a.level_learned_at > b.level_learned_at ? a : b));
    if (best.level_learned_at > 0 && best.level_learned_at <= currentLevel) {
      movesWithLevels.push({ name: mv.name, learnedAt: best.level_learned_at });
    }
  }

  // sort ascending and take last 4 (most recently learned)
  movesWithLevels.sort((a, b) => a.learnedAt - b.learnedAt);
  const selected = movesWithLevels.slice(Math.max(0, movesWithLevels.length - 4)).map((m) => m.name);
  return selected;
}

export async function getStarters(ids: number[]) {
  const promises = ids.map((id) => getPokemonTemplate(id));
  const templates = await Promise.all(promises);
  return templates;
}

export async function getMoveData(name: string) {
  if (moveCache.has(name)) return moveCache.get(name)!;
  const res = await fetch(`${API_BASE}/move/${name}`);
  if (!res.ok) throw new Error("Failed to fetch move " + name);
  const raw: any = await res.json();
  const entry = {
    name: raw.name,
    power: raw.power ?? null,
    accuracy: raw.accuracy ?? null,
    damage_class: raw.damage_class?.name ?? null,
    stat_changes: (raw.stat_changes || []).map((s: any) => ({ stat: s.stat?.name, change: s.change })),
    effect_entries: raw.effect_entries || []
  };
  moveCache.set(name, entry);
  return entry;
}

export async function getNextEvolution(pokemonId: number) {
  // fetch species to get species name and evolution chain url
  const spRes = await fetch(`${API_BASE}/pokemon-species/${pokemonId}`);
  if (!spRes.ok) return null;
  const species = await spRes.json();
  const speciesName: string = species.name;
  const chainUrl: string = species.evolution_chain?.url;
  if (!chainUrl) return null;
  const chainRes = await fetch(chainUrl);
  if (!chainRes.ok) return null;
  const chainJson = await chainRes.json();

  // find node matching speciesName
  function findNode(node: any): any | null {
    if (!node) return null;
    if (node.species?.name === speciesName) return node;
    if (node.evolves_to && node.evolves_to.length > 0) {
      for (const c of node.evolves_to) {
        const found = findNode(c);
        if (found) return found;
      }
    }
    return null;
  }

  const node = findNode(chainJson.chain);
  if (!node) return null;
  const evo = node.evolves_to && node.evolves_to[0];
  if (!evo) return null;
  const evoDetails = evo.evolution_details && evo.evolution_details[0];
  const minLevel = evoDetails?.min_level ?? null;
  // parse species id from evo.species.url
  const urlParts = evo.species.url.split("/").filter(Boolean);
  const idStr = urlParts[urlParts.length - 1];
  const evoId = parseInt(idStr, 10);
  return { id: evoId, name: evo.species.name, minLevel };
}

