# PaieCam — SaaS de paie pour PME camerounaises

## Stack

Monorepo pnpm + Turborepo. apps/web = Next.js (App Router, TypeScript strict).
packages/paie-engine = moteur de calcul pur (aucune dépendance I/O).
packages/db = Drizzle ORM + PostgreSQL 16. Tests : Vitest, Playwright.

## Règles absolues

- Aucun taux, plafond ou barème en dur : tout vient de la table pay_rules (valid_from/valid_to).
- Montants en entiers FCFA (integer), jamais de float. Taux en points de base (1 % = 100 bp).
- Toute requête métier passe par withTenant(tenantId) qui fixe app.tenant_id (RLS).
- Chaque Server Action et route API : 1) auth, 2) contrôle du rôle, 3) validation Zod, 4) audit_log.
- Jamais de donnée personnelle dans les logs (utiliser maskPII()).
- Jamais de secret dans le code ; lire via env.ts validé par Zod.
- Tout changement du moteur de paie doit faire passer les tests golden.
- Jamais de données réelles de salariés dans le dépôt ni dans les fixtures : uniquement des jeux fictifs.

## Commandes

pnpm dev | pnpm test | pnpm test:golden | pnpm lint | pnpm typecheck | pnpm db:up | pnpm db:migrate

## Définition de terminé

Tests unitaires + test d'autorisation multi-tenant + lint + typecheck verts.
