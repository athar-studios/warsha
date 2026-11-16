-- 008: add sessions table
CREATE TABLE sessions (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT NOT NULL,                   -- ULID as string
    project_id BLOB NOT NULL,               -- UUID (16 bytes)
    role TEXT NOT NULL,
    backend TEXT NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,               -- ISO 8601 datetime
    ended_at TEXT,                          -- ISO 8601 datetime
    parent_session_id TEXT,                 -- ULID as string
    cli_session_id TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_run_id ON sessions(run_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at ASC);
