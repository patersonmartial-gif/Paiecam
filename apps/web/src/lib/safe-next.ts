/** Caractère de contrôle (tabulation, retour à la ligne…) : refusé d'emblée. */
const hasControlChar = (v: string) => [...v].some((c) => c.charCodeAt(0) < 0x20);

/** Origine fictive : sert seulement à résoudre le chemin comme le ferait le navigateur. */
const BASE = "https://paiecam.invalid";

/**
 * N'accepte qu'un chemin interne, jamais une autre origine : pas de redirection ouverte.
 * L'adresse est résolue avec l'analyseur d'URL du navigateur, qui supprime tabulations et retours
 * à la ligne (« /\t/site » devient « //site ») : seul le résultat sur la même origine compte.
 */
export function safeNext(value: string | null | undefined, fallback = "/tableau-de-bord"): string {
  if (!value || !value.startsWith("/") || value.includes("\\") || hasControlChar(value))
    return fallback;
  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
