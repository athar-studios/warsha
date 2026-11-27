FROM node:22.23.5-bookworm-slim@sha256:be979e5523c76fa4d5ca4ebd3099078f220aa47ec39c48ad5b5df9314debd6eb

# Environment variables for deterministic capture
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    FONTCONFIG_FILE=/scripts/ci/capture-fontconfig.conf \
    NODE_OPTIONS="--dns-result-order=ipv4first"

# Install system dependencies for Playwright and Fontconfig
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    curl \
    ca-certificates \
    gnupg \
    fontconfig \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm and Playwright browser into /ms-playwright
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate && chmod 755 /usr/local/bin/pnpm

WORKDIR /build-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile \
    && pnpm exec playwright install chromium \
    && chmod -R 777 /ms-playwright \
    && rm -rf /build-deps/node_modules

# Install IBM Plex fonts using repo-pinned installer and verify fontconfig pin against Chromium
COPY scripts/ci/install-capture-fonts.sh /scripts/ci/install-capture-fonts.sh
COPY scripts/ci/capture-fontconfig.conf /scripts/ci/capture-fontconfig.conf
RUN chmod +x /scripts/ci/install-capture-fonts.sh && /scripts/ci/install-capture-fonts.sh

WORKDIR /work
