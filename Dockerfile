# VetPulse single-image production build.
#
# The API server (apps/api) also serves the compiled web client (apps/web/dist),
# so one container exposes the whole app on port 4000 without CORS or a
# reverse proxy. The Python CSV validator service is bundled alongside the API
# because /api/imports shells out to it.
#
# Build:  docker compose build
# Run:    docker compose up
# ...
# The database schema is applied on container start via `prisma migrate deploy`.

# ---------- stage 1: build the web client ----------
FROM node:22-alpine AS web-build
WORKDIR /app/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

# ---------- stage 2: build the API ----------
FROM node:22-alpine AS api-build
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci
COPY apps/api/ ./
RUN npx prisma generate && npm run build

# ---------- stage 3: runtime ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

# Python 3 for the CSV validator subprocess (stdlib-only module, no pip deps).
RUN apk add --no-cache python3

COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/node_modules ./node_modules
COPY --from=api-build /app/package.json ./package.json
# The Prisma CLI is needed at startup for `migrate deploy`.
COPY --from=api-build /app/prisma ./prisma
COPY data-service ./data-service
COPY --from=web-build /app/web/dist ./web/dist

ENV DATA_SERVICE_DIR=/app/data-service
EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
