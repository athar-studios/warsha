-- 018_secretary_chat.sql

CREATE TABLE secretary_conversations (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secretary_turns (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES secretary_conversations(id),
    role TEXT NOT NULL CHECK (role IN ('owner','secretary')),
    content TEXT NOT NULL,
    proposal_json TEXT,
    refs_owner_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE secretary_summaries (
    conversation_id TEXT PRIMARY KEY REFERENCES secretary_conversations(id),
    summary TEXT NOT NULL,
    covers_until TEXT NOT NULL
);
