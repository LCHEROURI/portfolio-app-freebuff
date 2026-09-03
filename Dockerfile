# ============================================================================
# Custom container image for the portfolio app on Firebase App Hosting.
#
# App Hosting's built-in source builds run in a slim runtime that lacks the
# shared libraries @sparticuz/chromium needs (libnspr4/libnss3 family), so
# the /api/print/pdf route 503s ("error while loading shared libraries:
# libnspr4.so"). Container-image deployments are the documented App Hosting
# path for full control over the runtime environment: this image installs the
# Chromium dependency set and serves the app with `next start`.
#
# Build-time env: the deploy script writes .env.production into the build
# context before `gcloud builds submit`, so both the build stage (NEXT_PUBLIC_
# inlining) and the runtime (server-side env) read the same values.
# ============================================================================
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-slim
# The bundled Chromium headless shell's shared-library set (Debian packages).
# Fonts make the PDF text render (missing fonts degrade silently).
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /app/.next ./.next
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/public ./public
COPY --from=build /app/.env.production ./.env.production
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
EXPOSE 8080
CMD ["sh", "-c", "./node_modules/.bin/next start -p ${PORT:-8080}"]