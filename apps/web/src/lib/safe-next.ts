/** N'accepte qu'un chemin interne (« /… »), jamais « //site » ni une URL absolue : pas de redirection ouverte. */
export function safeNext(value: string | null | undefined, fallback = "/tableau-de-bord"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return fallback;
  return value;
}
