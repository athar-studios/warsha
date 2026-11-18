-- 015_run_modes.sql
-- Run modes: Agent (default), Plan, spec-file, Ask

-- We add the run_mode field to the runs table.
-- Existing runs will be treated as 'Agent' mode.

ALTER TABLE runs ADD COLUMN run_mode TEXT NOT NULL DEFAULT 'Agent';
