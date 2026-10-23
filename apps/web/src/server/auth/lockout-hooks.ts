import { APIError } from "better-auth/api";
import type { Db } from "@paiecam/db";
import type { AuthHookContext } from "./audit";
import { lockedUntil, lockKey, recordFailure, resetFailures } from "./lockout";

const SIGN_IN = "/sign-in/email";
const emailOf = (ctx: AuthHookContext) => {
  const email = (ctx.body as { email?: unknown } | undefined)?.email;
  return typeof email === "string" ? email : null;
};

/**
 * Avant une connexion : refus immédiat si l'adresse est verrouillée, sans vérifier le mot de passe.
 * Les adresses inconnues sont comptées comme les autres (aucune différence de comportement).
 */
export async function signInLockoutBefore(db: Db, ctx: AuthHookContext): Promise<void> {
  if (ctx.path !== SIGN_IN) return;
  const email = emailOf(ctx);
  if (!email) return;
  const until = await lockedUntil(db, lockKey("signin", email));
  if (until) {
    throw new APIError("TOO_MANY_REQUESTS", {
      code: "ACCOUNT_TEMPORARILY_LOCKED",
      message: "Trop d'échecs de connexion : réessayez dans quelques minutes.",
    });
  }
}

/** Après une connexion : un échec de mot de passe incrémente le compteur, un succès le remet à zéro. */
export async function signInLockoutAfter(db: Db, ctx: AuthHookContext): Promise<void> {
  if (ctx.path !== SIGN_IN) return;
  const email = emailOf(ctx);
  if (!email) return;
  const returned = ctx.context.returned;
  if (returned instanceof APIError) {
    if (returned.status === "UNAUTHORIZED") await recordFailure(db, lockKey("signin", email));
    return;
  }
  await resetFailures(db, lockKey("signin", email));
}
