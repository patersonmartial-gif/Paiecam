/** Traduit une erreur du client Better Auth en clé de message, sans exposer le détail technique. */
export function authErrorKey(error: { status?: number; code?: string | undefined } | null): string {
  if (!error) return "common.errors.generic";
  if (error.status === 429) return "common.errors.tooManyRequests";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "auth.invalidCredentials";
    case "PASSWORD_TOO_SHORT":
      return "auth.passwordTooShort";
    case "PASSWORD_COMPROMISED":
      return "auth.passwordCompromised";
    case "USER_ALREADY_EXISTS":
    case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
      return "auth.emailTaken";
    case "INVALID_CODE":
    case "INVALID_TWO_FACTOR_AUTHENTICATION":
    case "INVALID_BACKUP_CODE":
      return "twoFactor.invalidCode";
    default:
      return "common.errors.generic";
  }
}
