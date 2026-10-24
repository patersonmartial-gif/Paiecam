import { APIError } from "better-auth/api";
import type { AuthHookContext } from "./audit";
import { COMMON_PASSWORDS } from "./common-passwords";

/** Champ du nouveau mot de passe, par point d'entrée de Better Auth. */
const PASSWORD_FIELDS: Record<string, string> = {
  "/sign-up/email": "password",
  "/change-password": "newPassword",
  "/reset-password": "newPassword",
};

const compromised = () =>
  new APIError("BAD_REQUEST", {
    code: "PASSWORD_COMPROMISED",
    message: "Ce mot de passe figure dans une fuite de données connue. Choisissez-en un autre.",
  });

/** Normalisation pour la comparaison : casse et espaces de bord ignorés. */
export const isCommonPassword = (password: string) =>
  COMMON_PASSWORDS.has(password.trim().toLowerCase());

/**
 * Vérification Have I Been Pwned « au mieux » (installation locale, souvent hors ligne) :
 * seuls 5 caractères de l'empreinte SHA-1 partent sur le réseau ; sans réponse sous 3 s,
 * la liste intégrée suffit et l'utilisateur n'est jamais bloqué.
 */
export async function isPwnedOnline(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const { createHash } = await import("node:crypto");
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  try {
    const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${sha1.slice(0, 5)}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const suffix = sha1.slice(5);
    return (await res.text())
      .split(/\r?\n/)
      .some((line) => line.startsWith(`${suffix}:`) && !line.endsWith(":0"));
  } catch {
    return false;
  }
}

/** Avant inscription ou changement de mot de passe : refuse les mots de passe courants. */
export async function passwordPolicyBefore(
  ctx: AuthHookContext,
  options: { onlineBestEffort: boolean; fetchImpl?: typeof fetch },
): Promise<void> {
  const field = PASSWORD_FIELDS[ctx.path];
  if (!field) return;
  const password = (ctx.body as Record<string, unknown> | undefined)?.[field];
  if (typeof password !== "string") return;
  if (isCommonPassword(password)) throw compromised();
  if (options.onlineBestEffort && (await isPwnedOnline(password, options.fetchImpl)))
    throw compromised();
}
