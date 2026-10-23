import { isIP } from "node:net";

/** En-tête interne posé par proxy.ts : seule source d'IP lue par l'application. */
export const CLIENT_IP_HEADER = "x-paiecam-client-ip";

export interface TrustConfig {
  /** En-tête posé par le proxy de l'hébergeur (ex. « x-forwarded-for », « x-real-ip ») ; null = aucun proxy. */
  header: string | null;
  /** Nombre de proxys de confiance devant l'application (pour x-forwarded-for). */
  hops: number;
}

/**
 * IP du client selon les proxys de confiance. Pour x-forwarded-for, on lit l'entrée ajoutée par
 * le dernier proxy de confiance (en partant de la droite) : les entrées de gauche sont fournies
 * par le client et peuvent être falsifiées.
 */
export function clientIp(headers: Headers, trust: TrustConfig): string | null {
  if (!trust.header) return null;
  const raw = headers.get(trust.header);
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const candidate =
    trust.header.toLowerCase() === "x-forwarded-for" ? parts[parts.length - trust.hops] : parts[0];
  return candidate && isIP(candidate) ? candidate : null;
}
