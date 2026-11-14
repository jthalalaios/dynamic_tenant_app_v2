# Single source of truth for the runtime: latest Node.js 24 LTS on Alpine 3.24.
# Node 24 runs the TypeScript sources directly (type stripping), so there is no build step.
ARG NODE_IMAGE=node:24.22.3-alpine3.24

# =========================
# Stage 1: dependencies
# =========================
FROM ${NODE_IMAGE} AS deps

WORKDIR /app

# Only the manifests: this layer is reused until the dependencies change
COPY nodejs-app/package.json nodejs-app/package-lock.json ./

# Dev dependencies included: the container also runs the test suite and type-check
RUN npm ci --no-audit --no-fund

# =========================
# Stage 2: runtime image
# =========================
FROM ${NODE_IMAGE}

WORKDIR /app

COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node nodejs-app/ .

COPY configuration/app_conf/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh \
    # The named node_modules volume is seeded from this directory with this ownership
    && chown node:node /app /app/node_modules

# uid 1000, like the host user: bind-mounted files stay owned by you
USER node

# API (nodejs-app) and websockets (realtime)
EXPOSE 3000 6001

ENTRYPOINT ["entrypoint.sh"]
CMD ["serve"]
