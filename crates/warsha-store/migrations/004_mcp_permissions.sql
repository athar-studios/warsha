-- KEEL K6: the per-chat `server::tool::role` MCP permission table.
--
-- A missing row is `ask` (the daemon's fail-closed default), never `allow`.
-- The CHECK constraint is the last line of defence behind the RPC's strict parse:
-- a row that says anything but the three accepted spells cannot be stored.
CREATE TABLE IF NOT EXISTS mcp_permissions (
    server      TEXT NOT NULL,
    tool        TEXT NOT NULL,
    role        TEXT NOT NULL,
    permission  TEXT NOT NULL CHECK (permission IN ('allow','ask','deny')),
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (server, tool, role)
);
