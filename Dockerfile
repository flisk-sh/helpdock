# Production image for Helpdock online (Render, or any container host). `flisk up` does not use this file: locally,
# Flisk builds its own images from services/*/*/service.json.
#
# Commands in the image:
#   start     (default) migrate, then the agent        for hosts with no pre-deploy step (Render free)
#   migrate   node migrator/.../prisma migrate deploy  on its own, for a host that runs it before each deploy
#   bun src/index.ts                                   the agent alone (page, /turn, /search, /docs)

FROM oven/bun:1.2-slim AS bun

FROM node:22-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /build

COPY services/agents/agent/package.json services/agents/agent/bun.lock agent/
RUN cd agent && bun install --frozen-lockfile --production
COPY services/agents/agent/src agent/src
# Bun runs the TypeScript as is. No bundle: `bun build` would fix process.env.NODE_ENV at build time.
COPY services/agents/agent/tsconfig.json agent/

COPY services/agents/agent-migrator/package.json services/agents/agent-migrator/bun.lock migrator/
RUN cd migrator && bun install --frozen-lockfile
COPY services/agents/agent-migrator/prisma migrator/prisma
COPY services/agents/agent-migrator/prisma.config.ts migrator/

FROM node:22-slim
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /build/agent ./
COPY --from=build --chown=node:node /build/migrator ./migrator
RUN printf '#!/bin/sh\nset -e\ncd /app/migrator\nexec node node_modules/prisma/build/index.js migrate deploy\n' \
      > /usr/local/bin/migrate && chmod +x /usr/local/bin/migrate \
 && printf '#!/bin/sh\nset -e\nmigrate\ncd /app\nexec bun src/index.ts\n' > /usr/local/bin/start && chmod +x /usr/local/bin/start

USER node
ENV PORT=10000
EXPOSE 10000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["start"]
