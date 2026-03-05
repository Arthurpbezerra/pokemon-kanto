/**
 * Configuração do evento secreto para um nome especial.
 * Não altere a estrutura do resto do projeto — este módulo é carregado apenas quando o nome coincide.
 */

const BASE = (typeof import.meta !== "undefined" && (import.meta as any).env?.BASE_URL) || "/";
const ASSETS = BASE.endsWith("/") ? `${BASE}assets/gigi/` : `${BASE}/assets/gigi/`;

/** Nome exato que dispara o evento (comparação case-insensitive). */
export const SECRET_NAME = "Gigi";

export function isSecretGigiName(name: string): boolean {
  return name.trim().toLowerCase() === SECRET_NAME.toLowerCase();
}

/** ID do Pokémon Eevee (ela recebe como inicial). */
export const EEVEE_ID = 133;

/** URL do sprite do Eevee (PokéAPI). */
export const EEVEE_SPRITE = "https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/133.png";

/** Textos do evento (estilo Game Boy). */
export const SECRET_TEXTS = {
  intro: "Um evento especial está acontecendo...",
  found: (playerName: string) => `${playerName} encontrou algo raro...`,
  choseYou: "Eevee escolheu você!",
  dialogueGigi: "Eevee quer ser seu parceiro nesta jornada!",
  dialogueButton: "Pegar Eevee",
  loveTitle: "Para a pessoa mais especial",
  loveMessage: "Amo muito você e fiz essa surpresinha <3",
} as const;

/** Assets na pasta public/assets/gigi/ — coloque a música e as imagens lá. */
export const SECRET_ASSETS = {
  /** Música que toca durante o evento (toca por completo). Altere o nome do arquivo aqui se for diferente (ex: gigi.mp3). */
  music: `${ASSETS}theme.mp3`,
  /** Imagem pixel da Gigi no diálogo do Eevee. */
  gigiPixel: `${ASSETS}gigi-pixel.png`,
  /** Foto dos dois com a mensagem de amor. */
  tutuEGigi: `${ASSETS}tutu-e-gigi.png`,
} as const;
