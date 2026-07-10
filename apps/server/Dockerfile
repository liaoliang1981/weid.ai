FROM node:22-slim
WORKDIR /repo
RUN corepack enable

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/db/package.json packages/db/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install

COPY . .

WORKDIR /repo/apps/server
EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @weid/db migrate && pnpm exec tsx src/index.ts"]
