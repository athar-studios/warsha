-- 013: add secretary interview state
CREATE TABLE secretary_interviews (
    project_id BLOB PRIMARY KEY NOT NULL,   -- UUID (16 bytes)
    state TEXT NOT NULL,                    -- JSON serialized InterviewState
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
