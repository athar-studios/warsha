# Deploying Warsha to production

This manual covers running the Warsha daemon (`warshad`) as a long-lived
production service with Docker Compose, fronted by Caddy for TLS, and the
domainless alternatives (Tailscale, Cloudflare Tunnel) for owners without a
public domain. It is the deployment half of the story told in
[DAEMON.md](DAEMON.md); read that first if you need the API contract.

Everything here ships in the repository under `docker/` and `deploy/`:

| File | Role |
|---|---|
| `docker/Dockerfile` | multi-stage image: Rust daemon + CLI, remote PWA bundle, hardened runtime |
| `docker/entrypoint.sh` | env-only configuration and first-start admin-token bootstrap |
| `docker/compose.yml` | production topology (daemon on an internal net, Caddy in front) |
| `deploy/docker-compose.yml` | the same topology, with paths relative to `deploy/` |
| `deploy/Caddyfile` | TLS termination, security headers, routing |
| `deploy/.env.example` | the documented environment template — placeholders only |

---

## 1. Prerequisites

- **Docker Engine ≥ 24 with Compose v2** (`docker compose version`). The
  image build uses BuildKit features (cache mounts), which Docker's Compose
  v2 enables by default.
- **A host firewall** that allows inbound 80 and 443 (and 443/udp for
  HTTP/3) and nothing else to this machine. The daemon itself never
  listens on the host — see section 2.
- **A DNS name** (optional but recommended): one A/AAAA record pointing at
  the host, e.g. `warsha.example.com`. Without one, jump to section 6.
- **An OpenAI-compatible model endpoint and key** for the pipeline. The
  default endpoint is the project's reference router
  (`https://router.sayl.site/v1`); any compatible gateway works. The key is
  the only true secret the deployment needs — everything else is generated.
- Enough disk for the data volume (SQLite database, artifacts, project
  factories). Start with a few GB.

Build and start from the repository root:

```bash
cd deploy
cp .env.example .env
chmod 0600 .env        # you will paste a provider key into it
$EDITOR .env           # see section 3
docker compose up -d --build
```

---

## 2. Network & port architecture

```
 Internet ──▶ host :80/:443(+udp) ──▶ caddy ──▶ warsha_internal ──▶ warshad :8765/:8766
              (TLS terminates here)            (internal bridge,   NO host ports,
                                                 no Internet route)  NO direct exposure
```

The deliberate shape of this topology:

- **`warshad` is attached only to `warsha_internal`**, a bridge network
  declared `internal: true`. Docker gives such networks no route to the
  host or the Internet. The daemon binds `0.0.0.0` inside the container —
  necessary because a container's loopback is unreachable from any client —
  but that wildcard bind is safe precisely because nothing outside the
  internal network can reach it.
- **The compose file has no `ports:` mapping for `warshad`.** Only `expose`
  (a documentation-level hint for other containers on the shared network).
  A `docker ps` on the host shows the daemon listening on nothing.
- **Caddy is the only dual-homed container**: `warsha_public` (with egress,
  for ACME) and `warsha_internal` (for the proxy hop). It is the only
  process holding certificates and keys, and the only one publishing 80,
  443, and 443/udp.
- **The daemon is plain HTTP.** It does not and must not terminate TLS;
  `advertised_host` accepts a bare host with no scheme for exactly this
  reason (see `DaemonConfig::advertised_host` in the daemon source).

Routing inside Caddy (`deploy/Caddyfile`): `/events*` and `/health` go to
`warshad:8765` (the axum HTTP surface: liveness and the live WebSocket/SSE
event stream); `/rpc*` and everything else go to `warshad:8766` (the
JSON-RPC surface, WebSocket upgrade or JSON POST). `flush_interval -1` on
the events route keeps streamed event frames unbuffered.

Remote UI serving: the image bakes the built `apps/remote` bundle at
`usr/share/warsha/remote` (and sets `WARSHA_REMOTE_ASSETS_DIR`). As of this
writing the daemon's HTTP router registers `/health` and `/events` and does
not yet mount that directory as a static file service, so the `/*` → 8766
route currently serves the RPC surface rather than the PWA shell. Serving
the bundle is a daemon-side change (a `ServeDir` on the HTTP port); until
it lands, mount or copy `/usr/share/warsha/remote` out of the image and
serve it from any static host on the same domain.

Hardening already expressed in the compose files: `user: "10001:10001"`,
`read_only: true` with a `/tmp` tmpfs, no privileged mode, no socket
mounts, `restart: unless-stopped`, and Caddy's admin API disabled.

---

## 3. Environment-only configuration

`docker/entrypoint.sh` reads nothing but the environment, and writes
`config.toml` only when it is missing. The full surface (defaults in
parentheses):

| Variable | Meaning |
|---|---|
| `WARSHA_DOMAIN` | Caddy site address; TLS for this name (`localhost`) |
| `WARSHA_ADVERTISED_HOST` | bare host/IP put into pairing links; **required** while the daemon binds `0.0.0.0`, because pairing links refuse to guess an interface |
| `WARSHA_LLM_BASE_URL` | OpenAI-compatible endpoint (`https://router.sayl.site/v1`) |
| `WARSHA_LLM_API_KEY` | provider key — **environment-only, never written to `config.toml`** and never logged; the log line reports `present`/`ABSENT`, nothing more |
| `WARSHA_LLM_MODEL` | model id (`bzl/deepseek-v4-flash-0731free`) |
| `WARSHA_ALLOWED_ORIGINS` | comma-separated CORS origins added to the built-in loopback/dev origins |

Inside the container, the ports (`WARSHA_HTTP_PORT` 8765, `WARSHA_WS_PORT`
8766) and data directory (`WARSHA_DATA_DIR` `/var/lib/warsha`) keep their
image defaults; overriding them in `.env` works through the entrypoint's
flags. Why environment-only: the container's root filesystem is read-only
in the hardened profile and the data volume must survive upgrades — a
configuration that lives in the environment is reproducible from `.env`
alone, while the one file the container writes (`config.toml`, with the
admin token) is volume state backed up with the database.

A note on the keychain policy: the desktop product keeps provider keys in
the OS keychain (AGENTS.md). A Linux container has no keychain, so the
policy for containers is "the process environment is the secret store, and
secrets never touch disk". `config.toml` therefore carries the daemon's own
bearer credential (necessary — the file is 0600 on the data volume) but
never the provider key.

---

## 4. First-start bootstrap admin token

There is **no anonymous admin path**. On the very first start of a fresh
data volume the entrypoint:

1. Generates a 256-bit token (`openssl rand -hex 32`) — or adopts
   `WARSHA_BOOTSTRAP_ADMIN_TOKEN` if the operator injected one for first
   boot only.
2. Writes `/var/lib/warsha/config.toml` under `umask 077` and `chmod 0600`
   with `auth_token` set to it (plus `data_dir`, `bind_host`, ports, and
   allowed origins — all from the environment).
3. Creates `/var/lib/warsha/.bootstrap_token_printed` **before** printing
   (a crash between the two can never earn a second printing).
4. Prints the token exactly once to stdout.

Retrieve it (works only if you read the logs of the first boot):

```bash
docker compose -f deploy/docker-compose.yml logs warshad \
  | grep -A1 "shown ONCE"
```

The printed block looks like:

```
 Warsha bootstrap admin token — shown ONCE, now, ever:
   source:  generated with openssl rand -hex 32
   token:   <the-64-hex-token-from-this-first-boot-log>
```

Move it into your OS keychain / password manager immediately. Every later
start — restarts, reboots, re-creates with the same volume — sees the
marker file and never prints again; if `config.toml` is deleted while the
marker survives, the entrypoint mints a fresh token into the file
*silently* (section 10 covers deliberate rotation).

---

## 5. DNS & automatic TLS with Caddy

1. Point an A (and/or AAAA) record for `WARSHA_DOMAIN` at the host.
2. Open 80/443 (+443/udp) on the firewall; 80 is needed for the ACME HTTP-01
   challenge even though all traffic ends up on HTTPS.
3. Set `WARSHA_DOMAIN=warsha.example.com`,
   `WARSHA_ADVERTISED_HOST=warsha.example.com` and
   `WARSHA_ALLOWED_ORIGINS=https://warsha.example.com` in `.env`, then
   `docker compose up -d`.

Caddy obtains a Let's Encrypt certificate on first request, renews it
automatically, and stores it in the `caddy-data` volume — keep that volume
in backups if you want to avoid re-issuance on rebuilds (rate limits apply).
Set `WARSHA_ADVERTISED_HOST` to the same name so pairing links advertise a
host the phone can actually dial. With `WARSHA_DOMAIN=localhost` Caddy uses
its local CA instead: fine for a LAN test, not for a phone you do not
control.

---

## 6. Domainless deployment paths

Both options below skip Caddy's public TLS by reaching the daemon over an
encrypted private network. You still never open 8765/8766 on the host's
public interface.

### 6a. Tailscale (recommended: zero configuration, zero cost)

Put the server host, the owner's desktop, and the Android phone on one
tailnet (install Tailscale on each; phone = Play Store / F-Droid app).

Run the daemon without the Caddy service and with a loopback-published port
on the host — Tailscale's serve proxy will dial it locally. Note the
`networks:` swap: a service attached only to an `internal: true` network
cannot have working published ports (the host itself has no route in), so
this path moves `warshad` onto an ordinary bridge whose *only* exposure is
`127.0.0.1`. Drop this into `deploy/compose.tailscale.yml` (an override
next to the main file):

```yaml
services:
  warshad:
    networks:
      - warsha_publish        # replaces warsha_internal for this profile
    ports:
      - "127.0.0.1:8765:8765"
      - "127.0.0.1:8766:8766"
  caddy:
    profiles: ["disabled"]    # nothing to proxy locally; keep the service off

networks:
  warsha_publish:
    driver: bridge
```

```bash
docker compose -f deploy/docker-compose.yml -f deploy/compose.tailscale.yml up -d --build warshad
```

The loopback bind is the point: the ports reach `127.0.0.1` only, which
only Tailscale (running on the host) can pick up. Then either:

- **Direct**: browse to `http://100.x.y.z:8766` (the host's tailnet address)
  and set `WARSHA_ADVERTISED_HOST=100.x.y.z`. Tailnet traffic stays
  encrypted wireguard-end-to-end even over plain HTTP application ports.
- **Tailscale Serve**: `tailscale serve --https=443 http://127.0.0.1:8766`
  on the host — Tailscale then terminates TLS with a real tailnet
  certificate at `https://<host>.<tailnet>.ts.net`, and you set
  `WARSHA_ADVERTISED_HOST` to that name.

### 6b. Cloudflare Tunnel (`cloudflared`) — outbound-only

`cloudflared` makes **no inbound connections**: it dials out to Cloudflare
and accepts the tunnel's traffic there, so the host firewall stays closed.

Because `warshad` has no host ports, `cloudflared` must join the Docker
network — it needs egress *and* the internal hop, so two networks:

```bash
cloudflared tunnel login
cloudflared tunnel create warsha
TUNNEL_ID=$(cloudflared tunnel list -U | grep warsha | awk '{print $1}')
cat > config.yml <<'EOF'
tunnel: TUNNEL_ID
credentials-file: /root/.cloudflare/TUNNEL_ID.json
ingress:
  - hostname: warsha.example.com
    service: http://warshad:8766
  - service: http_status:404
EOF
sed -i "s/TUNNEL_ID/$TUNNEL_ID/g" config.yml
docker run -d --name cloudflared \
  -v "$PWD/config.yml:/etc/cloudflared/config.yml:ro" \
  -v "$HOME/.cloudflare:/root/.cloudflare:ro" \
  --network deploy_warsha_internal \
  cloudflare/cloudflared:latest tunnel run --config /etc/cloudflared/config.yml
docker network connect bridge cloudflared   # gives the tunnel its egress
cloudflared tunnel route dns warsha warsha.example.com
```

Set `WARSHA_ADVERTISED_HOST=warsha.example.com` (Cloudflare serves HTTPS
at its edge; the daemon stays plain HTTP behind the tunnel) and add
`https://warsha.example.com` to `WARSHA_ALLOWED_ORIGINS`. The tunnel
terminates TLS at Cloudflare, so the strict HSTS/`X-Frame-Options` headers
of `deploy/Caddyfile` are Cloudflare's edge job instead; enable "Always
Use HTTPS" and a minimum TLS version in the Cloudflare dashboard.

---

## 7. End-to-end verification checklist

Work through this once after every fresh deployment:

1. **Health**: `curl -s https://WARSHA_DOMAIN/health` (or the tailnet/tunnel
   equivalent) returns `{"status":"healthy", ...}` with no token.
2. **Token bootstrap**: first-boot logs show the token block exactly once;
   `docker restart` the stack and confirm it does **not** reappear.
3. **Config perms**: `docker compose exec warshad ls -l
   /var/lib/warsha/config.toml` shows `-rw-------` owned by `warsha`.
4. **No host leak**: `ss -tlnp | grep -E '8765|8766'` on the host shows the
   daemon ports absent (except the deliberate loopback publish in the
   Tailscale path).
5. **Desktop → remote daemon pairing**: from the desktop app (or
   `warsha` CLI against the daemon), start device pairing (`devices.pair-start`
   RPC) and open the offered pairing link on the **Android phone** — the
   advertised host must be the DNS name / tailnet address / tunnel hostname,
   never `127.0.0.1`. Complete pairing on the phone; `devices.list` shows
   the phone.
6. **Phone starts a run**: approve a GateC/GateD flow from the phone UI
   (a run started from the phone appears in `runs.list`).
7. **Desktop observes live stage transitions**: keep the desktop event view
   open while the phone's run advances through stages; events arrive over
   `/events` with no refresh (this exercises the WebSocket/SSE hop, the
   `flush_interval` and the CORS origins).
8. **Run completes**: budget, artifacts and final stage render on both
   devices; nothing logs the token or provider key (grep the logs for the
   first characters of each — they must be absent).

If 7 fails while 5–6 pass, the suspect is almost always an origin missing
from `WARSHA_ALLOWED_ORIGINS` (the preflight is answered, the authenticated
upgrade is not) or a proxy buffering events.

---

## 8. Backup & restore

All mutable state is the `warsha-data` volume:

```
/var/lib/warsha/
├── config.toml                  # 0600 — contains the admin bearer token
├── .bootstrap_token_printed     # suppresses repeat token printing
├── warshad.lock / warshad.pid   # runtime state, not backed up
├── warsha.db                    # SQLite: projects, runs, events, settings
└── projects/<uuid>/factory/…    # pipeline artifacts
```

**Online database backup** (SQLite's own API — safe against concurrent
writes, no `cp` of a live db file):

```bash
cd deploy
docker compose exec warshad \
  sqlite3 /var/lib/warsha/warsha.db ".backup '/tmp/warsha-backup.db'"
docker compose cp warshad:/tmp/warsha-backup.db ./warsha-$(date +%F).db
```

(`sqlite3` is installed in the image for exactly this. `/tmp` is the tmpfs
the read-only container allows.)

**Config backup** — treat it as a secret, because it holds the admin token:

```bash
docker compose cp warshad:/var/lib/warsha/config.toml ./config-backup.toml
chmod 600 ./config-backup.toml
```

**Restore** onto a new host: create the volume, place `warsha.db` (and the
`projects/` tree) inside it **with the daemon stopped**, restore
`config.toml` (0600, owner 10001) *and* `.bootstrap_token_printed` so the
bootstrap prints nothing, then `docker compose up -d`. If you have a
config/db pair where they disagree on `data_dir`, prefer the config.

---

## 9. Upgrade & rollback

Upgrade (schema migrations run automatically on daemon start; `sqlx`
migrations are forward-only and idempotent):

1. Section-8 backup, both files.
2. `git pull` (or fetch the new tag), bump the image tag in the compose
   file if you pin one, `docker compose up -d --build`.
3. Re-run section 7 checks 1, 2 and 7.
4. Old images: `docker image prune`.

Rollback:

1. `docker compose down` (the volume persists).
2. Re-point the image tag at the previous release and `up -d`.
3. If the new version had already migrated `warsha.db` in a way the old
   binary cannot read, restore the pre-upgrade `warsha-<date>.db` backup.
   This is why step 1 of the upgrade list is not optional.

Configuration changes are `.env` edits followed by `docker compose up -d`
(the entrypoint re-passes ports/advertised-host flags from the new
environment). The one `.env` variable that must **not** be trusted to edit
`config.toml` retroactively is the admin token: the file is written once
(section 4).

---

## 10. Secret & token rotation

**Admin bearer token** (the `auth_token` in `config.toml`, used by the
desktop and CLI against this daemon):

1. `docker compose stop warshad`.
2. Start a one-off helper on the volume, or edit in place:
   `docker compose run --rm --no-deps -v warsha-data:/var/lib/warsha` with
   an editor image and replace `auth_token` with a fresh
   `openssl rand -hex 32` — or delete both `config.toml` and
   `.bootstrap_token_printed` and let a normal `up` re-bootstrap (the
   printed-once rules restart cleanly; you will need to re-point every
   local client).
3. `docker compose up -d`.
4. Re-enter the token in the desktop app / CLI; paired **phones are
   unaffected** — device credentials come from pairing, not from this
   token.

**Revoke a paired device**: `devices.revoke` RPC with its `device_id`
(desktop app → Devices, or JSON-RPC POST to `/rpc` with the admin token:
`-H "Authorization: Bearer $WARSHA_ADMIN_TOKEN"`). Revocation is durable
(`devices.revoked`); a revoked device's next connection is refused.

**Provider key** (`WARSHA_LLM_API_KEY`): edit `.env`, then
`docker compose up -d warshad`. Rotate at the provider first (revoke the
old key server-side). The key never existed on the volume, so there is
nothing to scrub there.

**TLS certificates**: automatic in Caddy; if you must force one,
`docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`
after removing its ACME data (last resort — issuance is rate-limited).

Rotation hygiene that this stack gives you for free: the token is generated
by `openssl` in the container, is never in a layer, never in an image,
never in `.env` unless you put it there, never in logs after the single
bootstrap block, and the entrypoint's env summary prints only
`present`/`ABSENT` for the provider key.
