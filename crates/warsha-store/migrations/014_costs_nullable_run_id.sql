-- 014: allow project-scoped costs (e.g. Secretary interview turns before a run exists)
-- to be recorded in `costs` with run_id = NULL while preserving CASCADE for run-scoped rows.
CREATE TABLE costs_new (
    id TEXT PRIMARY KEY NOT NULL,
    run_id TEXT,
    project_id BLOB NOT NULL,
    agent_role TEXT,
    provider_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    cache_read_tokens INTEGER NOT NULL DEFAULT 0,
    cache_write_tokens INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL DEFAULT 'api_metered',
    estimated INTEGER NOT NULL DEFAULT 0,
    cost_known INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    session_id TEXT,
    FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

INSERT INTO costs_new (
    id, run_id, project_id, agent_role, provider_id, model_id,
    prompt_tokens, completion_tokens, cost_cents, created_at,
    cache_read_tokens, cache_write_tokens, source, estimated,
    cost_known, duration_ms, session_id
)
SELECT
    id, run_id, project_id, agent_role, provider_id, model_id,
    prompt_tokens, completion_tokens, cost_cents, created_at,
    cache_read_tokens, cache_write_tokens, source, estimated,
    cost_known, duration_ms, session_id
FROM costs;

DROP TABLE costs;
ALTER TABLE costs_new RENAME TO costs;

CREATE INDEX idx_costs_run_id ON costs(run_id);
CREATE INDEX idx_costs_project_id ON costs(project_id);
CREATE INDEX idx_costs_project_role_date ON costs(project_id, agent_role, created_at);
