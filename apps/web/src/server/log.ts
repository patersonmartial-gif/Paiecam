/**
 * Masquage des données personnelles avant tout log ou toute trace d'audit.
 * Par nom de champ (n° CNPS, IBAN, salaires, contacts, secrets) et par motif dans le texte libre.
 */
const SENSITIVE_KEY =
  /cnps|iban|niu|bank|mobile|phone|telephone|email|salaire|salary|brut|gross|net|montant|amount|password|secret|token|otp|code|cookie|authorization/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// IBAN (2 lettres + 2 chiffres + 10 à 30 caractères) puis toute suite de 6 chiffres ou plus (téléphones, n° CNPS).
const IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g;
const LONG_NUMBER = /\d[\d .-]{4,}\d/g;

export const MASK = "[masqué]";

function maskString(value: string): string {
  return value.replace(EMAIL, MASK).replace(IBAN, MASK).replace(LONG_NUMBER, MASK);
}

export function maskPII(value: unknown, depth = 0): unknown {
  if (depth > 8) return MASK;
  if (typeof value === "string") return maskString(value);
  if (Array.isArray(value)) return value.map((v) => maskPII(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: maskString(value.message) };
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) && v !== null && v !== undefined ? MASK : maskPII(v, depth + 1),
      ]),
    );
  }
  return value;
}

type Level = "info" | "warn" | "error";

/** Logs structurés JSON sur une ligne, toujours masqués. */
export function log(level: Level, message: string, meta: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message: maskString(message),
    ...(maskPII(meta) as Record<string, unknown>),
  });
  if (level === "info") process.stdout.write(line + "\n");
  else console.error(line);
}
