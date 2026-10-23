# Image de production PaieCam : cible « web » (Next.js autonome) et cible « worker » (pg-boss).
# Construction : docker build -f docker/app/Dockerfile --target web --build-arg APP_URL=https://… -t paiecam-web .
#                docker build -f docker/app/Dockerfile --target worker -t paiecam-worker .
# Aucun secret dans l'image : toute la configuration vient des variables d'environnement.
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/paie-engine/package.json packages/paie-engine/
COPY packages/security/package.json packages/security/
COPY packages/documents/package.json packages/documents/
COPY tools/architecture/package.json tools/architecture/
RUN pnpm install --frozen-lockfile

FROM deps AS build
ARG APP_URL
COPY . .
RUN APP_URL="$APP_URL" sh scripts/build-web.sh

FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# Le worker et les migrations s'exécutent depuis les sources (tsx), sans les dépendances de développement inutiles.
FROM deps AS worker
ENV NODE_ENV=production
COPY . .
RUN chown -R node:node /app
USER node
CMD ["pnpm", "--filter", "@paiecam/web", "worker"]
