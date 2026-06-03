FROM node:20-bookworm AS build

WORKDIR /app

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund

COPY . .

RUN npm run build

FROM node:20-bookworm-slim

WORKDIR /app

COPY --from=build /app /app

EXPOSE 3001

ENV UPTIME_KUMA_IS_CONTAINER=1

HEALTHCHECK CMD node extra/healthcheck

CMD ["node", "server/server.js"]
