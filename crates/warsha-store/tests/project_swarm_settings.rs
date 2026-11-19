#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

use sqlx::SqlitePool;
use warsha_store::{SettingsRepo, StoredProjectSwarmSettings};

async fn fixture_pool(path: &std::path::Path) -> SqlitePool {
    // Similar to settings_migration fixture
    let options = sqlx::sqlite::SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal);

    let pool = SqlitePool::connect_with(options).await.expect("pool");

    // Apply migrations
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrations");

    pool
}

#[tokio::test]
async fn project_swarm_settings_round_trip() {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("warsha.db");
    let pool = fixture_pool(&path).await;
    let repo = SettingsRepo::from_pool(pool);

    let swarm_settings = StoredProjectSwarmSettings {
        project_id: "test-project".to_string(),
        enable_swarm: true,
        max_parallel_agents: 8,
    };

    repo.save_project_swarm_settings(&swarm_settings)
        .await
        .expect("save");

    let loaded = repo
        .load_project_swarm_settings("test-project")
        .await
        .expect("load");
    assert_eq!(loaded, swarm_settings);

    let defaults = repo
        .load_project_swarm_settings("unknown")
        .await
        .expect("load default");
    assert!(!defaults.enable_swarm);
    assert_eq!(defaults.max_parallel_agents, 4);
}
