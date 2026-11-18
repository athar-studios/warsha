-- 016: allow sessions (e.g. Secretary / Ask mode) to have NULL run_id
CREATE TABLE sessions_new (
    id TEXT PRIMARY KEY NOT NULL,           -- ULID as string
    run_id TEXT,                            -- ULID as string, nullable for Ask/Secretary
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

INSERT INTO sessions_new (
    id, run_id, project_id, role, backend, provider, model, status,
    started_at, ended_at, parent_session_id, cli_session_id
)
SELECT
    id, run_id, project_id, role, backend, provider, model, status,
    started_at, ended_at, parent_session_id, cli_session_id
FROM sessions;

DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;

CREATE INDEX idx_sessions_run_id ON sessions(run_id);
CREATE INDEX idx_sessions_project_id ON sessions(project_id);
CREATE INDEX idx_sessions_started_at ON sessions(started_at ASC);
