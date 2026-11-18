use ulid::Ulid;
use warsha_pipeline::swarm::{decompose, Subtask, SwarmScheduler};

#[tokio::test]
async fn test_decompose() {
    let plan = "split_2";
    let subtasks = decompose(plan);
    assert!(subtasks.len() >= 2);
    assert_eq!(subtasks[0].files, vec!["src/lib.rs"]);
    assert_eq!(subtasks[1].files, vec!["src/main.rs"]);
}

#[tokio::test]
async fn test_scheduler_max_agents() {
    let scheduler = SwarmScheduler::new(4);
    for i in 0..4 {
        let st = Subtask {
            id: Ulid::new(),
            title: format!("T{}", i),
            files: vec![format!("{}.rs", i)],
        };
        assert!(scheduler.can_dispatch(&st).await);
        scheduler.running_subtasks.lock().await.push(st);
    }
    let st5 = Subtask {
        id: Ulid::new(),
        title: "T5".to_string(),
        files: vec!["5.rs".to_string()],
    };
    assert!(!scheduler.can_dispatch(&st5).await);
}
