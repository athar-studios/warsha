-- 019_agent_provisioning.sql
-- What the Secretary assigned each rostered agent before it may start:
-- skills, tools, and the audited source. One row per (project, agent).

CREATE TABLE agent_provisioning (
    project_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    skills_json TEXT NOT NULL,
    tools_json TEXT NOT NULL,
    source TEXT NOT NULL,
    audited INTEGER NOT NULL DEFAULT 0 CHECK (audited IN (0, 1)),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (project_id, agent_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_provisioning_project
    ON agent_provisioning(project_id);
