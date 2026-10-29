-- M1: gates, artifacts and costs

CREATE TABLE gates (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT NOT NULL,                   -- ULID as string
    stage TEXT NOT NULL,                    -- JSON serialized Stage
    state TEXT NOT NULL,                    -- JSON serialized GateState
    decided_by_device_id BLOB,              -- UUID (16 bytes, optional)
    reason TEXT,                            -- Rejection reason (optional)
    notes TEXT,                             -- Changes-requested notes (optional)
    decided_at TEXT,                        -- ISO 8601 datetime (optional)
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    updated_at TEXT NOT NULL,               -- ISO 8601 datetime
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_gates_run_id ON gates(run_id);

CREATE TABLE artifacts (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT NOT NULL,                   -- ULID as string
    project_id BLOB NOT NULL,               -- UUID (16 bytes)
    name TEXT NOT NULL,                     -- Artifact name within the run
    kind TEXT NOT NULL,                     -- Artifact kind (markdown, patch, ...)
    content_path TEXT NOT NULL,             -- Path to the stored content
    sha256 TEXT,                            -- Content hash (optional)
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    updated_at TEXT NOT NULL,               -- ISO 8601 datetime
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX idx_artifacts_project_id ON artifacts(project_id);

CREATE TABLE costs (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT NOT NULL,                   -- ULID as string
    project_id BLOB NOT NULL,               -- UUID (16 bytes)
    agent_role TEXT,                        -- JSON serialized Role (optional)
    provider_id TEXT NOT NULL,              -- Provider identifier
    model_id TEXT NOT NULL,                 -- Model identifier
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,  -- Cost in cents
    created_at TEXT NOT NULL,               -- ISO 8601 datetime
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE INDEX idx_costs_run_id ON costs(run_id);
CREATE INDEX idx_costs_project_id ON costs(project_id);
