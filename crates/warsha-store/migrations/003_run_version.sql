-- M2: run-state integrity (version for CAS updates)

ALTER TABLE runs ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
