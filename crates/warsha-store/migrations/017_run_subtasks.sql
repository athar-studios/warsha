-- 017_run_subtasks.sql

CREATE TABLE run_subtasks (
    id UUID PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(id),
    session_id UUID REFERENCES sessions(id),
    title TEXT NOT NULL,
    files TEXT NOT NULL, -- JSON TEXT array
    status TEXT NOT NULL, -- Queued, Dispatched, Succeeded, Failed
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_settings (
    project_id TEXT PRIMARY KEY,
    enable_swarm BOOLEAN NOT NULL DEFAULT FALSE,
    max_parallel_agents INTEGER NOT NULL DEFAULT 4
);
