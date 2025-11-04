-- Add columns to support grouped uploads (folders) and relative paths
ALTER TABLE uploads ADD COLUMN group_id TEXT;
ALTER TABLE uploads ADD COLUMN relative_path TEXT;

-- Backfill existing rows so group_id is populated
UPDATE uploads SET group_id = file_id WHERE group_id IS NULL;

-- Create index to speed up grouped operations
CREATE INDEX IF NOT EXISTS idx_group_id ON uploads(group_id);
