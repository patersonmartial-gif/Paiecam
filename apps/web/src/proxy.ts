import { NextResponse, type NextRequest } from "next/server";
import { CLIENT_IP_HEADER, clientIp } from "@/lib/client-ip";

/** IP partagée par les clients non identifiés (aucun proxy configuré) : la limite de tentatives reste active. */
export const UNKNOWN_IP = "0.0.0.0";

const trust = {
  header: process.env.TRUSTED_PROXY_HEADER?.toLowerCase() || null,
  hops: Number(process.env.TRUSTED_PROXY_HOPS ?? "1") || 1,
};
const isDev = process.env.NODE_ENV !== "production";

/** CSP stricte : scripts uniquement avec le nonce de la requête. */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    // 'unsafe-eval' uniquement en développement (rechargement à chaud de React).
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Attributs style= de React : autorisés ; aucune feuille externe.
    "style-src 'self' 'unsafe-inline'",
    // data: pour le QR code de la 2FA (généré dans le navigateur).
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  // Toute valeur envoyée par le client est écrasée.
  headers.set(CLIENT_IP_HEADER, clientIp(request.headers, trust) ?? UNKNOWN_IP);

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Toutes les routes (pages, actions, API d'authentification), sauf les fichiers statiques.
    { source: "/((?!_next/static|_next/image|favicon.ico).*)" },
  ],
};
