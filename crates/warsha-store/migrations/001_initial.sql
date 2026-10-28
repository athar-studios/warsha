-- Initial schema for Warsha

CREATE TABLE projects (
    id BLOB PRIMARY KEY NOT NULL,           -- UUID (16 bytes)
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    language TEXT NOT NULL DEFAULT 'en',    -- 'ar' or 'en'
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    updated_at TEXT NOT NULL,               -- ISO 8601 datetime
    repo_path TEXT,                         -- Local repository path
    repo_url TEXT                           -- Remote repository URL
);

CREATE INDEX idx_projects_created_at ON projects(created_at DESC);

CREATE TABLE runs (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    project_id BLOB NOT NULL,               -- UUID (16 bytes)
    current_stage TEXT NOT NULL,            -- JSON serialized Stage
    gate_states TEXT NOT NULL,              -- JSON serialized HashMap<Stage, GateState>
    artifacts TEXT NOT NULL,                -- JSON serialized HashMap<String, Artifact>
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    updated_at TEXT NOT NULL,               -- ISO 8601 datetime
    status TEXT NOT NULL,                   -- JSON serialized RunStatus
    budget_cents INTEGER,                   -- Optional budget in cents
    spent_cents INTEGER NOT NULL DEFAULT 0, -- Spent in cents
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_runs_project_id ON runs(project_id);
CREATE INDEX idx_runs_created_at ON runs(created_at DESC);

CREATE TABLE events (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT NOT NULL,                   -- ULID as string
    stage TEXT NOT NULL,                    -- JSON serialized Stage
    role TEXT,                              -- JSON serialized Role (optional)
    kind TEXT NOT NULL,                     -- JSON serialized EventKind
    payload TEXT NOT NULL,                  -- JSON payload
    cost_cents INTEGER,                     -- Optional cost in cents
    tokens TEXT,                            -- JSON serialized TokenUsage (optional)
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    device_id BLOB,                         -- UUID (16 bytes, optional)
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_events_run_id ON events(run_id);
CREATE INDEX idx_events_created_at ON events(created_at ASC);

CREATE TABLE providers (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,                     -- JSON serialized ProviderKind
    models TEXT NOT NULL,                   -- JSON serialized Vec<ModelConfig>
    credentials TEXT NOT NULL,              -- JSON serialized CredentialsRef
    enabled INTEGER NOT NULL DEFAULT 1,     -- Boolean as integer
    priority INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE role_routings (
    role TEXT PRIMARY KEY NOT NULL,         -- JSON serialized Role
    targets TEXT NOT NULL,                  -- JSON serialized Vec<RoutingTarget>
    fallback_enabled INTEGER NOT NULL DEFAULT 1,
    budget_cents_per_run INTEGER,           -- Optional budget in cents
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE devices (
    id BLOB PRIMARY KEY NOT NULL,           -- UUID (16 bytes)
    name TEXT NOT NULL,
    public_key BLOB NOT NULL,               -- X25519 public key (32 bytes)
    paired_at TEXT NOT NULL,                -- ISO 8601 datetime
    last_seen_at TEXT,                      -- ISO 8601 datetime (optional)
    revoked INTEGER NOT NULL DEFAULT 0,     -- Boolean as integer
    revoked_at TEXT                         -- ISO 8601 datetime (optional)
);

CREATE INDEX idx_devices_paired_at ON devices(paired_at DESC);