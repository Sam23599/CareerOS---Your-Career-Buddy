CREATE TABLE IF NOT EXISTS resume_drafts (
    id UUID PRIMARY KEY,
    owner_id TEXT NOT NULL,
    resume_id UUID NOT NULL,
    source_hash TEXT NOT NULL,
    source_version INTEGER NOT NULL,
    analyzer_version TEXT NOT NULL,
    model TEXT NOT NULL,
    reasoning TEXT,
    record JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE NULLS NOT DISTINCT (owner_id, resume_id, source_hash, source_version, analyzer_version, model, reasoning)
);
CREATE INDEX IF NOT EXISTS resume_drafts_owner_source ON resume_drafts (owner_id, resume_id, created_at DESC);
CREATE TABLE IF NOT EXISTS deleted_resume_sources (
    owner_id TEXT NOT NULL,
    resume_id UUID NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, resume_id)
);
