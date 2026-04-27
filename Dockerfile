FROM node:20-slim AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci

FROM node:20-slim AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package*.json tsconfig.json ./
COPY src ./src
COPY types ./types

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
COPY src/templates ./dist/src/templates

EXPOSE 3000

CMD ["node", "dist/src/server.js"]
