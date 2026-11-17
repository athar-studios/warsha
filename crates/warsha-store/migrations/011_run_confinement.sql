-- B2: the confinement a run is confined by, persisted with the run so the
-- read-only backstop survives a restart. Legacy rows read NULL and the run
-- then inherits nothing — the pipeline resolves the effective policy at start.
ALTER TABLE runs ADD COLUMN confinement TEXT;
