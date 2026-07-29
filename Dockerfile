# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/classifier/package.json ./packages/classifier/
COPY packages/db/package.json ./packages/db/
COPY packages/wrap/package.json ./packages/wrap/
COPY packages/facilitator/package.json ./packages/facilitator/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app /app
COPY tsconfig.base.json ./
COPY packages ./packages
RUN pnpm build \
  && pnpm --filter @x500/facilitator deploy --prod /out

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=build /out ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
