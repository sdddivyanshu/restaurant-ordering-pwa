# Production image: multi-stage build, non-root runtime, migrations applied by a release step.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 UPLOAD_DIR=/data/uploads
RUN groupadd -r app && useradd -r -g app app && mkdir -p /data/uploads && chown -R app:app /data
COPY --from=build --chown=app:app /app/.next ./.next
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/lib/generated ./lib/generated
COPY --from=build --chown=app:app /app/package.json /app/next.config.ts /app/prisma.config.ts ./
COPY --from=build --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Run `npx prisma migrate deploy` as a separate release/one-off task before starting new versions.
CMD ["npx", "next", "start", "-p", "3000"]
