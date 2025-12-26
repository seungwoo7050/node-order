# syntax=docker/dockerfile:1
FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY order-console-next/package.json order-console-next/
RUN npm ci -w order-console-next

FROM deps AS build
COPY order-console-next/ order-console-next/
WORKDIR /app/order-console-next
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_STORAGE_URL=http://localhost:9000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STORAGE_URL=$NEXT_PUBLIC_STORAGE_URL \
    NEXT_TELEMETRY_DISABLED=1 \
    SKIP_TYPECHECK=1
RUN npm run build

FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /app/order-console-next/.next/standalone ./
COPY --from=build /app/order-console-next/.next/static ./order-console-next/.next/static
COPY --from=build /app/order-console-next/public ./order-console-next/public
USER node
EXPOSE 3000
CMD ["node", "order-console-next/server.js"]
