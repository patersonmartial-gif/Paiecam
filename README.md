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
- [x] Phase 5 — Déclarations (états CNPS, DGI, DIPE provisoire, journal), dépôts, verrouillage, rappels e-mail
- [ ] Phase 6 — Durcissement

Les taux du moteur ne sont pas dans le code : ils viennent de `pay_rules`. Les fixtures de test
sont fictives et doivent être remplacées par le référentiel validé par l'expert-comptable.

## Moteur de paie

- Référentiel 2026 en brouillon : `packages/paie-engine/rules/cm-2026.draft.json` (sources et questions par règle).
- `pnpm --filter @paiecam/paie-engine rules:check` : cohérence du référentiel.
- `pnpm --filter @paiecam/db rules:load ../paie-engine/rules/cm-2026.draft.json` : chargement en base (brouillon).
- `pnpm --filter @paiecam/paie-engine dossier:expert ../../dossier/dossier.xlsx` : dossier de validation pour l'expert-comptable.
- En production, le moteur refuse de calculer avec une règle non validée.
