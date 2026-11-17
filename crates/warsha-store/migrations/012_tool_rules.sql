-- B3: owner-authored tool rules (deny/ask/allow) — one global set plus one
-- optional per-project override set. Rules never override the command
-- allowlist or confinement (those stay the hard floor); they sit on top.
-- A NULL project_id row is the global set; a project row replaces the global
-- set for that project except that a global deny always wins.
CREATE TABLE IF NOT EXISTS tool_permission_rules (
    scope       TEXT NOT NULL,          -- 'global' or the project id
    rules_json  TEXT NOT NULL,          -- serialised ToolRules {deny, ask, allow}
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (scope)
);
