-- 018_secretary_chat.sql

CREATE TABLE secretary_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secretary_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES secretary_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','secretary')),
    content TEXT NOT NULL,
    proposal_json TEXT,
    refs_owner_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secretary_summaries (
    conversation_id TEXT PRIMARY KEY REFERENCES secretary_conversations(id) ON DELETE CASCADE,
    summary TEXT NOT NULL,
    covers_until TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secretary_turns_conv ON secretary_turns(conversation_id, created_at);

-- At most one global (project-less) thread: the secretary has a single global conversation.
CREATE UNIQUE INDEX IF NOT EXISTS idx_secretary_global_thread ON secretary_conversations((1)) WHERE project_id IS NULL;
