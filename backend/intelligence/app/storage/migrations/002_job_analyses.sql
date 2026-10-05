CREATE TABLE job_analyses (
    id UUID PRIMARY KEY,
    owner_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    analysis_version INTEGER NOT NULL CHECK (analysis_version > 0),
    record JSONB NOT NULL,
    UNIQUE (owner_id, job_id, analysis_version)
);
CREATE TABLE deleted_job_sources (
    owner_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    deleted_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (owner_id, job_id)
);
