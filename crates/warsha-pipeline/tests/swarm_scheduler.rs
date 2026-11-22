#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

use ulid::Ulid;
use warsha_pipeline::swarm::{Subtask, SwarmScheduler};

#[tokio::test]
async fn test_scheduler_parallelism() {
    let scheduler = SwarmScheduler::new(4);

    let subtask1 = Subtask {
        id: Ulid::new(),
        title: "T1".to_string(),
        files: vec!["a.rs".to_string()],
    };
    let subtask2 = Subtask {
        id: Ulid::new(),
        title: "T2".to_string(),
        files: vec!["b.rs".to_string()],
    };

    assert!(scheduler.can_dispatch(&subtask1).await);
    // Simulate dispatch
    scheduler.running_subtasks.lock().await.push(subtask1);

    assert!(scheduler.can_dispatch(&subtask2).await);
}

#[tokio::test]
async fn test_overlap_check() {
    let scheduler = SwarmScheduler::new(4);

    let subtask1 = Subtask {
        id: Ulid::new(),
        title: "T1".to_string(),
        files: vec!["a.rs".to_string()],
    };
    let subtask2 = Subtask {
        id: Ulid::new(),
        title: "T2".to_string(),
        files: vec!["a.rs".to_string()],
    };

    scheduler.running_subtasks.lock().await.push(subtask1);

    // Should not be able to dispatch because a.rs is locked
    assert!(!scheduler.can_dispatch(&subtask2).await);
}
