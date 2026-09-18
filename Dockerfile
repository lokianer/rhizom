# syntax=docker/dockerfile:1

# ---- build: install the workspace, compile core and server, bundle the web app ----
FROM node:22-bookworm-slim AS build
RUN npm install -g pnpm@12.4.2
WORKDIR /app

# Copy only the manifests first so the install layer stays cached until a dependency changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN SKIP_INSTALL_SIMPLE_GIT_HOOKS=1 pnpm install --frozen-lockfile

COPY . .
RUN pnpm run build

# Drop devDependencies with a fresh production install from this stage's own store (nothing is
# downloaded). A plain `pnpm install --prod` on top of the full install would keep the dev
# packages in node_modules/.pnpm as pnpm's orphan cache. --ignore-scripts: the root "prepare"
# script needs simple-git-hooks, itself a devDependency, and nothing in the production tree has a
# build script.
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && pnpm install --frozen-lockfile --prod --ignore-scripts

# ---- runtime: only the compiled output and production dependencies ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3737
WORKDIR /app

COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/server/package.json ./apps/server/
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist

USER node
EXPOSE 3737
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:' + process.env.PORT + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "apps/server/dist/server.js"]
