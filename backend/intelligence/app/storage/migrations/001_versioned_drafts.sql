ALTER TABLE resume_drafts DROP CONSTRAINT IF EXISTS resume_drafts_owner_id_resume_id_source_hash_source_version_key;
ALTER TABLE resume_drafts ADD COLUMN draft_version INTEGER;
WITH numbered AS (
    SELECT id, row_number() OVER (PARTITION BY owner_id, resume_id ORDER BY created_at, id)::INTEGER AS version
    FROM resume_drafts
)
UPDATE resume_drafts SET draft_version = numbered.version FROM numbered WHERE resume_drafts.id = numbered.id;
UPDATE resume_drafts SET record = jsonb_set(record, '{version}', to_jsonb(draft_version));
ALTER TABLE resume_drafts ALTER COLUMN draft_version SET NOT NULL;
ALTER TABLE resume_drafts ADD CONSTRAINT resume_drafts_positive_version CHECK (draft_version > 0);
CREATE UNIQUE INDEX resume_drafts_owner_version ON resume_drafts (owner_id, resume_id, draft_version);
