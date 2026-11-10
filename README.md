# PaieCam

SaaS de paie pour PME camerounaises. Règles du projet : voir [CLAUDE.md](CLAUDE.md).

## Démarrer

```bash
cp .env.example .env
pnpm install
pnpm db:up          # PostgreSQL 16 dans Docker
pnpm db:migrate
pnpm dev            # http://localhost:3000
pnpm --filter @paiecam/web worker   # tâches de fond (PDF des bulletins), dans un second terminal
```

Tests : `pnpm test` (unitaires + intégration sur `paiecam_test`), `pnpm --filter @paiecam/web test:e2e` (Playwright).
Hors ligne en développement, `PWNED_PASSWORDS_CHECK=off` coupe l'appel à Have I Been Pwned (interdit en production).

## Structure

| Dossier                | Rôle                                              |
| ---------------------- | ------------------------------------------------- |
| `apps/web`             | Next.js (App Router) : interface + Server Actions |
| `packages/paie-engine` | Moteur de paie pur, sans I/O, couverture 100 %    |
| `packages/db`          | Schéma Drizzle, migrations, client PostgreSQL     |

## Avancement

- [x] Phase 0 — Fondations : monorepo, CI, Docker Compose, env.ts
- [x] Phase 1 — Auth et multi-tenant (RLS, 2FA, audit_log, tests anti-IDOR)
- [x] Phase 2 — Référentiels : fiche entreprise, invitations, salariés, champs chiffrés, import Excel
- [~] Phase 3 — Moteur de paie : calcul complet fait sur un référentiel 2026 en BROUILLON ; validation de l'expert-comptable et bulletins golden en attente
- [x] Phase 4 — Cycle mensuel (saisie, calcul, contrôle, validation) et bulletins PDF signés
  - Prêts et avances : échéancier, retenue automatique, suspension d'un mois, solde suivi ; plafond légal des retenues en brouillon (barème du décret n° 94/197/PM à fournir par l'expert-comptable)
- [x] Phase 5 — Déclarations (états CNPS, DGI, DIPE provisoire, journal), dépôts, verrouillage, rappels e-mail
- [x] Phase 7 — Clinique et pharmacie : catalogue et prix libres, stock par lot et péremption (FEFO), caisse et factures (numérotation sans trou, avoirs, reçus vérifiables), clôture de caisse, rapports et export Excel, tableau de bord ; TVA en brouillon (à valider)
- [~] Phase 6 — Durcissement : revue ASVS L2, SMTP/S3/Docker, sauvegardes testées, textes juridiques en projet, plan d'incident ; en attente : relecture par l'avocat, durées de conservation (purge), préproduction (ZAP, test d'intrusion)

## Essayer en ligne (GitHub Codespaces)

Sur la page du dépôt : **Code → Codespaces → Create codespace on main**. La première ouverture
installe tout (5 à 10 minutes) : PostgreSQL 16, dépendances, base migrée, règles de paie chargées,
secrets tirés au hasard pour ce seul Codespace. PaieCam s'ouvre ensuite sur le port 3000.

- **Données fictives uniquement** : un Codespace n'est pas un hébergement conforme à la loi 2024/017.
- Pas de serveur d'e-mail : le lien de vérification du compte s'affiche dans
  `.data/journaux/web.log` (commande `grep -A3 "mail:dev" .data/journaux/web.log`).
- Arrêtez le Codespace après l'essai (quota gratuit limité) ; il reprend où il en était.

## Installation locale (PC Windows)

Version installable sur un seul PC, sans hébergement : voir [docs/installation-locale.md](docs/installation-locale.md).
Construction de l'installateur : workflow « Installateur Windows » (GitHub Actions).

Les taux du moteur ne sont pas dans le code : ils viennent de `pay_rules`. Les fixtures de test
sont fictives et doivent être remplacées par le référentiel validé par l'expert-comptable.

## Moteur de paie

- Référentiel 2026 en brouillon : `packages/paie-engine/rules/cm-2026.draft.json` (sources et questions par règle).
- `pnpm --filter @paiecam/paie-engine rules:check` : cohérence du référentiel.
- `pnpm --filter @paiecam/db rules:load ../paie-engine/rules/cm-2026.draft.json` : chargement en base (brouillon).
- `pnpm --filter @paiecam/paie-engine dossier:expert ../../dossier/dossier.xlsx` : dossier de validation pour l'expert-comptable.
- En production, le moteur refuse de calculer avec une règle non validée.
