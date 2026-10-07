CREATE TABLE cady_conversations (
    owner_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK (revision > 0),
    context JSONB,
    turns JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
