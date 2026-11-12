FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:24-bookworm-slim
ENV NODE_ENV=production PORT=3001 POKER_HOST=0.0.0.0 POKER_DATA_DIR=/app/data POKER_WEB_DIR=/app/apps/web/dist
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3001
CMD ["node", "apps/server/dist/index.js"]
