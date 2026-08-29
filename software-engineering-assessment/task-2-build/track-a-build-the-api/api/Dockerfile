# Context is the track root (see docker-compose.yml). seed.json lives there
# because the assignment put it next to compose, not inside api/.
FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/prisma ./prisma
RUN npx prisma generate

FROM deps AS build
COPY api/tsconfig.json api/tsconfig.build.json api/nest-cli.json ./
COPY api/src ./src
RUN npm run build

# One-shot: apply migrations, load seed.json, exit. Full node_modules (tsx,
# prisma CLI) stay here; they are not in the runtime image.
FROM deps AS migrate
COPY seed.json ./seed.json
ENV SEED_PATH=/app/seed.json
CMD ["sh", "-c", "npx prisma migrate deploy && npx prisma db seed"]

FROM node:22-alpine AS api
WORKDIR /app
RUN apk add --no-cache openssl libc6-compat
ENV NODE_ENV=production
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=deps /app/node_modules/@prisma/client ./node_modules/@prisma/client
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
