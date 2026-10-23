/**
 * Neutralise une valeur texte avant export tableur (injection de formules, OWASP « CSV injection ») :
 * une cellule commençant par =, +, -, @, tabulation ou retour chariot est préfixée d'une apostrophe,
 * pour qu'Excel ou LibreOffice l'affichent comme du texte au lieu de l'exécuter.
 */
export function spreadsheetSafe(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
