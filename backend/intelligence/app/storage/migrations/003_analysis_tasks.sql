CREATE TABLE analysis_tasks (
    id UUID PRIMARY KEY, owner_id TEXT NOT NULL, job_id TEXT NOT NULL,
    request_key UUID NOT NULL, source_hash TEXT NOT NULL, payload JSONB NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued','running','succeeded','failed','cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until TIMESTAMPTZ, analysis_id UUID, error_code TEXT,
    UNIQUE(owner_id, request_key)
);
CREATE INDEX analysis_tasks_owner_history ON analysis_tasks(owner_id, created_at DESC);
CREATE INDEX analysis_tasks_queue ON analysis_tasks(state, created_at);
