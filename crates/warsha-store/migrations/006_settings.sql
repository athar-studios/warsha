-- 006: the settings schema, owned by the async migrator (P-E7, OD-E7).
--
-- These are the small, settings-shaped rows the daemon and the pipeline write
-- one at a time: taste preferences, backend kits, run modes, phone pairings,
-- configured providers, harnesses, skills, plugins, custom models, integrations
-- and the per-project active harness. They used to be created by a second,
-- synchronous `rusqlite` schema in `persistence.rs`; there is one stack now, so
-- this file is the only place the settings tables come from.
--
-- TWO TRAPS, both recorded in DECISIONS.md (the entry that names
-- `configured_providers`): this file runs over the *same* `warsha.db` as
-- 001-004, so
--   1. the configured providers are `configured_providers`, never `providers` —
--      001 already creates a `providers` table (id/name/kind/models/…), and a
--      second table of that name failed every daemon start; and
--   2. every statement is `CREATE TABLE IF NOT EXISTS`, because a daemon
--      database that this schema already created (by the older synchronous
--      store) must migrate cleanly rather than collide.
--
-- The pairing-expiry column (audit H1) is part of the table here instead of a
-- separate `ALTER TABLE` step: `ALTER TABLE … ADD COLUMN` has no `IF NOT
-- EXISTS`, so a migration that ran on both a fresh and an existing database
-- could not be idempotent. A pre-H1 database still has the four-column table;
-- `Store` repairs that shape after the migrator runs (see
-- `ensure_settings_schema`), adding the column and grandfathering the rows a
-- pre-H1 daemon paired with a 10-minute grace window.

CREATE TABLE IF NOT EXISTS preferences (
    project_id     TEXT    NOT NULL,
    key            TEXT    NOT NULL,
    score          REAL    NOT NULL,
    evidence_count INTEGER NOT NULL,
    last_updated   INTEGER NOT NULL,
    PRIMARY KEY (project_id, key)
);
CREATE TABLE IF NOT EXISTS backend_kits (
    project_id  TEXT PRIMARY KEY,
    kind        TEXT NOT NULL,
    url         TEXT NOT NULL,
    config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_modes (
    mode        TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pairing_devices (
    device_id  TEXT PRIMARY KEY,
    secret     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    revoked    INTEGER NOT NULL,
    expires_at INTEGER
);
CREATE TABLE IF NOT EXISTS configured_providers (
    name       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    api_base   TEXT,
    enabled    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS harnesses (
    id         TEXT PRIMARY KEY,
    version    TEXT NOT NULL,
    name       TEXT NOT NULL,
    description TEXT NOT NULL,
    data_json  TEXT NOT NULL,
    is_preset  INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    source      TEXT NOT NULL,
    license     TEXT NOT NULL,
    content     TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tags_json   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plugins (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL,
    transport   TEXT NOT NULL,
    command     TEXT,
    args_json   TEXT NOT NULL,
    env_json    TEXT NOT NULL,
    enabled     INTEGER NOT NULL,
    tools_json  TEXT NOT NULL,
    source      TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_models (
    provider       TEXT NOT NULL,
    model_id       TEXT NOT NULL,
    display_name   TEXT,
    context_window INTEGER,
    enabled        INTEGER NOT NULL,
    PRIMARY KEY (provider, model_id)
);
CREATE TABLE IF NOT EXISTS integrations (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    connected     INTEGER NOT NULL,
    config_json   TEXT NOT NULL,
    configured_at INTEGER
);
CREATE TABLE IF NOT EXISTS active_harness (
    project_id TEXT PRIMARY KEY,
    harness_id TEXT NOT NULL
);
