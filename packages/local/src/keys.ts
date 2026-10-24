import { generateX25519Identity, identityToRecipient } from "age-encryption";

/**
 * Clé du kit de récupération : la clé secrète (AGE-SECRET-KEY-1…) est imprimée et rangée hors du
 * PC ; seule la clé publique (age1…) reste dans la configuration pour chiffrer les sauvegardes.
 * Format X25519 standard : lisible aussi par l'outil « age » en ligne de commande.
 */
export async function generateRecoveryKey(): Promise<{ identity: string; recipient: string }> {
  const identity = await generateX25519Identity();
  return { identity, recipient: await identityToRecipient(identity) };
}
