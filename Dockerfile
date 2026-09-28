# One image, two commands: `npm start` for the web app, `npm run worker` for the
# scheduler. Keeping them identical means the worker can never drift out of sync
# with the code that scheduled the work.

FROM node:22-slim AS base
WORKDIR /app
# openssl is required by Prisma's query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `public/` is optional in a Next app and this one has no static files, so the
# folder is not in the repository — and the runtime stage copies it, which
# failed the whole build with "not found". Created here so it always exists.
RUN mkdir -p public && npx prisma generate && npm run build

FROM base AS runtime
ENV NODE_ENV=production
ENV MEDIA_DIR=/app/media

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
CMD ["npm", "start"]
