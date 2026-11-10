# Revue de sécurité — OWASP ASVS niveau 2

Revue du code de PaieCam (Server Actions, routes, authentification, données), phase 6.
Ce document ne remplace pas le **test d'intrusion externe** exigé avant le lancement commercial.

## Contrôles en place (vérifiés par des tests automatisés)

| Domaine ASVS        | Contrôle                                                                                                                                           | Où c'est testé                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| V2 Authentification | Argon2id (paramètres OWASP), 12 caractères minimum, Have I Been Pwned (fermé en cas d'échec)                                                       | `apps/web/test/auth.test.ts`                       |
| V2 Authentification | 2FA TOTP obligatoire pour propriétaire et gestionnaire paie ; codes de secours                                                                     | `test/authz.test.ts`, `e2e/onboarding.spec.ts`     |
| V2 Authentification | Limite par IP (en-tête de confiance) et verrouillage progressif par compte (1 / 5 / 15 min), adresses inconnues incluses                           | `test/auth.test.ts`, `src/lib/client-ip.test.ts`   |
| V3 Sessions         | Session serveur de 8 h sans prolongation, cookie HttpOnly / SameSite=Lax / Secure, jeton régénéré à la connexion, révocation à la réinitialisation | `test/auth.test.ts`                                |
| V4 Contrôle d'accès | RLS PostgreSQL forcé sur toutes les tables d'entreprise ; rôle applicatif sans BYPASSRLS ; clés étrangères composites (tenant_id, …)               | `packages/db/test/*.test.ts`                       |
| V4 Contrôle d'accès | Chaque action : session → appartenance → permission → 2FA → Zod → RLS → audit ; tests anti-IDOR sur chaque ressource                               | `test/*.test.ts`, `tools/architecture`             |
| V5 Validation       | Zod côté serveur sur toutes les entrées ; fichiers Excel contrôlés (signature, taille, bombe zip) ; cellules exportées neutralisées                | `src/server/import/import.test.ts`                 |
| V6 Cryptographie    | AES-256-GCM par champ, lié à l'entreprise, la table, la colonne et la ligne ; trousseau versionné ; sous-clés HKDF par usage                       | `packages/security` (couverture 100 %)             |
| V7 Journalisation   | Audit en insertion seule, dans la même transaction que l'action ; logs JSON masqués (maskPII)                                                      | `test/authz.test.ts`, `src/server/log.test.ts`     |
| V8 Données          | Affichage masqué des n° CNPS / IBAN ; affichage en clair audité et réservé ; aucune valeur en clair en base                                        | `test/employees.test.ts`                           |
| V12 Fichiers        | PDF et états stockés chiffrés, écriture unique, liens signés de 5 minutes, fichier remplacé détecté                                                | `test/documents.test.ts`                           |
| V14 Configuration   | CSP avec nonce, frame-ancestors 'none', HSTS, COOP/CORP, nosniff ; aucune violation CSP sur les parcours                                           | `e2e/headers.spec.ts`, garde-fou `e2e/fixtures.ts` |

## Constats de la revue

| N°  | Sévérité | Constat                                                                                              | Correction                                                                                                       | État          |
| --- | -------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------- |
| R1  | Moyenne  | L'IP du client était lue dans `x-forwarded-for` (falsifiable) : limites contournables                | IP calculée par `proxy.ts` selon `TRUSTED_PROXY_HEADER` (obligatoire en production)                              | Corrigé (6.1) |
| R2  | Moyenne  | Ressaisie du mot de passe (IBAN, validation) sans limite d'essais                                    | Verrouillage progressif par utilisateur                                                                          | Corrigé (6.1) |
| R3  | Moyenne  | Pas de verrouillage par compte : attaque répartie sur plusieurs IP possible                          | Verrouillage progressif par adresse (empreinte)                                                                  | Corrigé (6.1) |
| R4  | Moyenne  | Injection d'en-têtes possible dans les e-mails (raison sociale dans le sujet)                        | `sanitizeMail` : retours à la ligne neutralisés, destinataire unique validé                                      | Corrigé (6.2) |
| R5  | Moyenne  | Invitations illimitées : envoi massif d'e-mails depuis un compte compromis                           | 20 invitations par entreprise et par heure                                                                       | Corrigé (6.2) |
| R6  | Faible   | Dépendance esbuild vulnérable (GHSA-67mh-4wv8-2f99) via drizzle-kit                                  | Version forcée ≥ 0.25 (`pnpm-workspace.yaml`)                                                                    | Corrigé (6.2) |
| R7  | Faible   | Mise en file des PDF hors transaction et worker silencieux en cas d'échec                            | Mise en file après validation ; échecs journalisés                                                               | Corrigé (4.5) |
| R8  | Faible   | Sauvegarde impossible avec FORCE RLS sans rôle dédié (pg_dump du propriétaire filtré)                | Rôle `paiecam_backup` lecture seule, BYPASSRLS ; restauration testée                                             | Corrigé (6.4) |
| R9  | Info     | Cookie de langue sans HttpOnly ni Secure (contenu non sensible)                                      | HttpOnly, Secure en production ; test e2e                                                                        | Corrigé (6.6) |
| R10 | Moyenne  | Redirection après connexion contournable : « /\t/site » devient « //site » dans le navigateur        | `safeNext` résout l'adresse comme le navigateur et exige la même origine ; tests                                 | Corrigé (CI)  |
| R11 | Faible   | Longueur de l'étiquette AES-GCM non imposée au déchiffrement (Semgrep)                               | `authTagLength: 16` au chiffrement et au déchiffrement                                                           | Corrigé (CI)  |
| R12 | Faible   | Chaîne d'approvisionnement : actions GitHub par étiquette, paquets installables dès leur publication | Actions épinglées par empreinte ; pnpm : 7 jours minimum, pas de dépendance hors registre ; Dependabot : 7 jours | Corrigé (CI)  |

## Risques résiduels (à couvrir par le test d'intrusion ou l'exploitation)

1. **Énumération de comptes par le temps de réponse** à la connexion (vérification Argon2 seulement pour les comptes existants) : à mesurer pendant le test d'intrusion.
2. **Page publique `/verifier/<code>`** sans limite de requêtes : codes de 80 bits, non énumérables en pratique ; une limite par IP est à poser au niveau du proxy ou du CDN.
3. **Journal d'audit** protégé contre l'application (insertion seule), mais pas contre un administrateur de la base : chaînage par empreintes ou export WORM à envisager.
4. **`style-src 'unsafe-inline'`** (attributs `style=` de React) : risque faible (pas d'exécution de script), à supprimer si les styles en ligne disparaissent.
5. **Accès d'exploitation à la base de production** : comptes nominatifs, 2FA, journalisés (procédure d'exploitation, hors code).
6. **Mises à jour de sécurité** : Dependabot et `pnpm audit` en CI ; Better Auth est épinglé et doit être suivi de près.
