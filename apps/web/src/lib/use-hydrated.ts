import { useEffect, useState } from "react";

/**
 * Vrai une fois le composant hydraté. Avant, un clic enverrait le formulaire nativement (sans
 * le gestionnaire React) : les boutons d'envoi restent désactivés jusque-là.
 */
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}
