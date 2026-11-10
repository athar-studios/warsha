# syntax=docker/dockerfile:1.28
#
# docker/Dockerfile — multi-stage production image for the Warsha daemon.
#
# Build from the REPOSITORY ROOT (the whole workspace is the build context):
#   docker build -f docker/Dockerfile -t warsha/warshad:0.1.0 .
#
# Stages:
#   1. web-assets   — builds the apps/remote PWA static bundle with pnpm.
#   2. rust-builder — builds `warshad` and the `warsha` CLI from the Cargo
#                     workspace with --release --locked.
#   3. runtime      — debian:bookworm-slim, non-root `warsha` (10001:10001),
#                     tini as PID 1, and an env-only entrypoint that owns
#                     first-start bootstrap of the admin bearer token.
#
# The image ships no secrets: the admin token is generated (or adopted from
# WARSHA_BOOTSTRAP_ADMIN_TOKEN) by the entrypoint at first start into the
# 0600 /var/lib/warsha/config.toml on the data volume, and the provider API
# key is only ever passed through the process environment. See docs/DEPLOY.md.

# Pinned for reproducibility; must be >= 1.89 because uuid@1.29.0 requires rustc >= 1.89.0.
ARG RUST_IMAGE=rust:1-bookworm
ARG NODE_IMAGE=node:22.23.4-bookworm-slim
ARG RUNTIME_IMAGE=debian:bookworm-slim

# --------------------------------------------------------------------------
# Stage 1: web-assets — the remote PWA the daemon serves in-container.
# --------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web-assets

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

WORKDIR /src

# Full workspace copy: @warsha/ui, @warsha/i18n and @warsha/client are
# source-linked workspace packages the remote app imports directly.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json eslint.config.js ./
COPY packages ./packages
COPY apps/remote ./apps/remote

RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

RUN pnpm --filter warsha-remote build

# Vite writes the bundle to apps/remote/dist (outDir in vite.config.ts).
RUN test -f /src/apps/remote/dist/index.html \
    || (echo "FATAL: remote PWA build produced no dist/index.html" >&2 && exit 1)

# --------------------------------------------------------------------------
# Stage 2: rust-builder — warshad + the `warsha` CLI binary.
# --------------------------------------------------------------------------
FROM ${RUST_IMAGE} AS rust-builder

# pkg-config + libssl-dev: openssl-sys is linked in through reqwest's
# default TLS feature; the build also needs a C toolchain for the bundled
# SQLite (rusqlite `bundled`) and for `ring`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# The Cargo workspace covers crates/* only; the daemon and CLI do not need
# anything under apps/ or packages/.
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

ENV CARGO_BUILD_JOBS=2
RUN --mount=type=cache,id=cargo-registry,target=/usr/local/cargo/registry \
    --mount=type=cache,id=cargo-git,target=/usr/local/cargo/git \
    --mount=type=cache,id=cargo-target,target=/src/target \
    cargo build --release --locked -p warshad -p warsha-cli \
    && cp /src/target/release/warshad /usr/local/bin/warshad \
    && cp /src/target/release/warsha /usr/local/bin/warsha

# --------------------------------------------------------------------------
# Stage 3: runtime — minimal Debian, non-root, read-only friendly.
# --------------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        openssl \
        sqlite3 \
        tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root service account and its data directory. The directory must exist
# with these ownership bits INSIDE the image so that Docker copies them into
# a fresh named volume on first mount (a read_only container cannot chmod
# its own volume at runtime).
RUN groupadd --gid 10001 warsha \
    && useradd --uid 10001 --gid 10001 --system \
        --home-dir /var/lib/warsha --shell /usr/sbin/nologin warsha \
    && install -d -m 0700 -o warsha -g warsha /var/lib/warsha

COPY --from=rust-builder /usr/local/bin/warshad /usr/local/bin/warshad
COPY --from=rust-builder /usr/local/bin/warsha /usr/local/bin/warsha
COPY --from=web-assets /src/apps/remote/dist /usr/share/warsha/remote
COPY docker/entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip CRLF if the repo was checked out with core.autocrlf=true, then make
# the entrypoint executable (the runtime user cannot chmod it later: / is
# read-only in the hardened compose profile).
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod 0755 /usr/local/bin/docker-entrypoint.sh

ENV WARSHA_DATA_DIR=/var/lib/warsha \
    WARSHA_BIND_HOST=0.0.0.0 \
    WARSHA_HTTP_PORT=8765 \
    WARSHA_WS_PORT=8766 \
    WARSHA_REMOTE_ASSETS_DIR=/usr/share/warsha/remote \
    WARSHA_LLM_BASE_URL=https://router.sayl.site/v1 \
    WARSHA_LLM_MODEL=bzl/deepseek-v4-flash-0731free \
    RUST_LOG=info

USER 10001:10001
WORKDIR /var/lib/warsha

VOLUME ["/var/lib/warsha"]
EXPOSE 8765 8766

# `\$` keeps the shell expansion of WARSHA_HTTP_PORT at container runtime
# instead of letting the Dockerfile parser bake the build-time default.
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${WARSHA_HTTP_PORT:-8765}/health" || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
