FROM node:20.19.6-slim AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci --omit=dev --workspace api

FROM node:20.19.6-slim AS runtime

ENV NODE_ENV=production

WORKDIR /app/apps/api

COPY --from=dependencies /app/node_modules /app/node_modules
COPY --from=dependencies /app/package.json /app/package.json
COPY --from=dependencies /app/package-lock.json /app/package-lock.json
COPY --from=dependencies /app/apps/api/package.json ./package.json
COPY apps/api/src ./src

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 4000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
