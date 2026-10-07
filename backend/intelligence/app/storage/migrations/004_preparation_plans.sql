ALTER TABLE analysis_tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'job_analysis'
    CHECK (kind IN ('job_analysis','preparation'));
CREATE TABLE preparation_plans (
    id UUID PRIMARY KEY, owner_id TEXT NOT NULL, job_id TEXT NOT NULL, resume_id TEXT NOT NULL,
    plan_version INTEGER NOT NULL CHECK (plan_version > 0),
    record JSONB NOT NULL, review JSONB NOT NULL, review_revision INTEGER NOT NULL DEFAULT 0,
    UNIQUE(owner_id, job_id, plan_version)
);
CREATE INDEX preparation_owner_job ON preparation_plans(owner_id, job_id, plan_version DESC);
CREATE INDEX preparation_owner_resume ON preparation_plans(owner_id, resume_id);
