# Greenlit: API, background workers and the web app in one image.
#   docker build -f docker/Dockerfile -t greenlit .
# The `dev` target is the development container (docker/compose.dev.yaml, profile `app`): the same tools, the source
# bind-mounted, `pnpm dev` with hot reload. Production never uses it.

FROM node:26-trixie-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN npm install -g pnpm@12.21.0 >/dev/null 2>&1 || corepack enable
WORKDIR /app

# ── FigCraft (MIT OR Apache-2.0): its browser build, which the viewer frames to show and edit design files, and
#    figcraft-cli, which renders their thumbnails and exports frames. Pinned release files, checked by SHA-256
#    (apps/server/src/modules/figcraft/install.ts). ─────────────────────────────────────────────────────────────
FROM base AS figcraft
COPY apps/server/package.json apps/server/
COPY apps/server/src/core/static.ts apps/server/src/core/
COPY apps/server/src/lib/zip.ts apps/server/src/lib/
COPY apps/server/src/modules/figcraft/webapp.ts apps/server/src/modules/figcraft/install.ts apps/server/src/modules/figcraft/
RUN node apps/server/src/modules/figcraft/install.ts web /opt/figcraft/web \
    && node apps/server/src/modules/figcraft/install.ts cli /opt/figcraft/bin

# ── dependencies (cached separately from the source) ────────────────────────
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/composition/package.json packages/composition/
COPY packages/player/package.json packages/player/
COPY packages/platforms/package.json packages/platforms/
# The API Anything fork builds itself on install (its `prepare`), so its source comes in with it.
COPY packages/api-anything packages/api-anything
RUN pnpm install --frozen-lockfile

# ── web build ───────────────────────────────────────────────────────────────
FROM deps AS web
COPY . .
RUN pnpm --filter @greenlit/web build

# ── the tools both the app and the dev container need ──────────────────────────
FROM base AS tools
# ffmpeg (x264, SVT-AV1, Opus), Chromium for rendering and platform sessions, JPEG XL tools for archival,
# poppler for PDF thumbnails, adb for Greenlit's Android device, fonts so text renders the same everywhere.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg chromium libjxl-tools poppler-utils adb tini ca-certificates \
      fonts-noto-core fonts-noto-color-emoji fonts-liberation2 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=figcraft /opt/figcraft /opt/figcraft
ENV GREENLIT_FIGCRAFT_WEB_DIR=/opt/figcraft/web \
    GREENLIT_FIGCRAFT_CLI=/opt/figcraft/bin/figcraft-cli

# ── development container ────────────────────────────────────────────────────
FROM tools AS dev
ENV NODE_ENV=development \
    GREENLIT_CHROMIUM=/usr/bin/chromium \
    GREENLIT_WEB_HOST=0.0.0.0
# Mount points for the dependency volumes, owned by the unprivileged user so files stay yours on the host.
RUN mkdir -p /app/node_modules /app/apps/server/node_modules /app/apps/web/node_modules \
      /app/packages/shared/node_modules /app/packages/composition/node_modules /app/packages/player/node_modules \
      /app/packages/platforms/node_modules /app/packages/api-anything/node_modules /pnpm/store \
    && chown -R node:node /app /pnpm
USER node
ENV npm_config_store_dir=/pnpm/store
EXPOSE 4300 4310
ENTRYPOINT ["/usr/bin/tini", "--"]
# Installs into the container's own node_modules volumes (never the host's), then runs API + web with hot reload.
CMD ["sh", "-c", "pnpm install --frozen-lockfile && pnpm dev"]

# ── runtime ─────────────────────────────────────────────────────────────────
FROM tools AS runtime
ENV NODE_ENV=production \
    GREENLIT_DATA_DIR=/data \
    GREENLIT_PORT=8080 \
    GREENLIT_CHROMIUM=/usr/bin/chromium \
    GREENLIT_WEB_DIST=/app/apps/web/dist
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
COPY --from=web /app/apps/web/dist ./apps/web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:8080/api/config').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/server/src/main.ts"]
