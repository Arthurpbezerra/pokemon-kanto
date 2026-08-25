/** Prefix public/ files with Vite BASE_URL (GitHub Pages lives under /pokemon-kanto/). */
export function publicUrl(path: string) {
  const base = import.meta.env.BASE_URL || "/";
  const relative = path.replace(/^\//, "");
  return `${base.endsWith("/") ? base : `${base}/`}${relative}`;
}
