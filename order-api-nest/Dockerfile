# syntax=docker/dockerfile:1

FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY order-api-nest/package.json order-api-nest/
RUN npm ci -w order-api-nest

FROM deps AS build
COPY order-api-nest/ order-api-nest/
WORKDIR /app/order-api-nest
RUN npx prisma generate && npm run build

FROM build AS migrate
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY order-api-nest/package.json order-api-nest/
RUN npm ci -w order-api-nest --omit=dev

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/order-api-nest/dist ./order-api-nest/dist
COPY order-api-nest/package.json ./order-api-nest/
WORKDIR /app/order-api-nest
USER node
EXPOSE 4000
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]