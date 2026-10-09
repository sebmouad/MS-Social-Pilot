# One image, two commands: `npm start` for the web app, `npm run worker` for the
# scheduler. Keeping them identical means the worker can never drift out of sync
# with the code that scheduled the work.
#
# What reaches the build is filtered by .dockerignore — `.env` and uploaded
# media in particular must never end up in a layer.

FROM node:22-slim AS base
WORKDIR /app
# openssl is required by Prisma's query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
# Dev dependencies stay: the runtime needs two of them — the `prisma` CLI for
# `migrate deploy` on boot and `tsx` to run the worker — and pruning around
# them saves little next to what those two weigh.
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` is optional in a Next app and this one has no static files, so the
# folder is not in the repository — and the runtime stage copies it, which
# failed the whole build with "not found". Created here so it always exists.
# The build cache is dropped because nothing at runtime reads it and it runs
# to hundreds of MB.
RUN mkdir -p public \
    && npx prisma generate \
    && npm run build \
    && rm -rf .next/cache

FROM base AS runtime
ENV NODE_ENV=production
ENV MEDIA_DIR=/app/media
# Unprivileged: the image runs as `node`, which cannot bind 80 — the default
# for a bare-metal install. Compose pins the same value; this is for
# `docker run` and other orchestrators.
ENV PORT=3000
ENV HOST=0.0.0.0

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json next.config.mjs ./
COPY prisma ./prisma
COPY scripts ./scripts
COPY src ./src
COPY messages ./messages
COPY tsconfig.json ./

RUN mkdir -p /app/media && chown -R node:node /app/media
USER node

EXPOSE 3000

# node rather than curl or wget: node:22-slim ships neither. The same probe
# docker-compose.yml runs; the worker service turns it off, since no server
# listens in that container.
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=6 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

CMD ["npm", "start"]
