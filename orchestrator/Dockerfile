# OceanJet dispatcher — Cloud Run service (src/dispatcher-service).
# The single place that picks and claims OceanJet bookings for every VM.
# The VMs do not use this image; they run the orchestrator with `npm run dev`.
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx tsc && npm prune --omit=dev

# Secrets (Bookaway login) come from Secret Manager as env vars at runtime.
ENV NODE_ENV=production
# Cloud Run provides PORT (defaults to 8080).
CMD ["node", "dist/dispatcher-service/index.js"]
