# PaieCam

SaaS de paie pour PME camerounaises. Règles du projet : voir [CLAUDE.md](CLAUDE.md).

## Démarrer

```bash
cp .env.example .env
pnpm install
pnpm db:up          # PostgreSQL 16 dans Docker
pnpm db:migrate
pnpm dev            # http://localhost:3000
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
- [ ] Phase 2 — Référentiels (entreprise, salariés, champs chiffrés)
- [~] Phase 3 — Moteur de paie : résolution des règles datées et CNPS faits ; IRPP, CAC, taxes et golden à venir
- [ ] Phase 4 — Cycle mensuel et bulletins PDF
- [ ] Phase 5 — Déclarations
- [ ] Phase 6 — Durcissement

Les taux du moteur ne sont pas dans le code : ils viennent de `pay_rules`. Les fixtures de test
sont fictives et doivent être remplacées par le référentiel validé par l'expert-comptable.
