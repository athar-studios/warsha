use uuid::Uuid;
use warsha_store::Store;

async fn temp_store() -> (tempfile::TempDir, Store) {
    let dir = tempfile::tempdir().expect("tempdir");
    let path = dir.path().join("warsha.db");
    let store = Store::open_at(path).await.expect("store");
    (dir, store)
}

#[tokio::test]
async fn secretary_chat_round_trip() {
    let (_dir, store) = temp_store().await;
    let project_a = Uuid::new_v4();
    let project_b = Uuid::new_v4();

    let global_conv = store
        .create_secretary_conversation(None)
        .await
        .expect("create global");
    assert_eq!(global_conv.project_id, None);

    let conv_a = store
        .create_secretary_conversation(Some(project_a))
        .await
        .expect("create project a");
    assert_eq!(conv_a.project_id, Some(project_a));

    let _conv_b = store
        .create_secretary_conversation(Some(project_b))
        .await
        .expect("create project b");

    let fetched = store
        .get_secretary_conversation(conv_a.id)
        .await
        .expect("get")
        .expect("exists");
    assert_eq!(fetched, conv_a);

    // list_secretary_conversations(None) returns only global threads
    let global_only = store
        .list_secretary_conversations(None)
        .await
        .expect("list global");
    assert_eq!(global_only.len(), 1);
    assert_eq!(global_only[0].id, global_conv.id);

    // list_secretary_conversations(Some(project_a)) returns project_a + global
    let proj_a_list = store
        .list_secretary_conversations(Some(project_a))
        .await
        .expect("list project a");
    assert_eq!(proj_a_list.len(), 2);
    let ids: Vec<_> = proj_a_list.iter().map(|c| c.id).collect();
    assert!(ids.contains(&global_conv.id));
    assert!(ids.contains(&conv_a.id));

    // Add turns and verify order + updated_at touch
    let turn1 = store
        .add_secretary_turn(conv_a.id, "owner", "hello", None, None)
        .await
        .expect("add turn 1");
    assert_eq!(turn1.conversation_id, conv_a.id);
    assert_eq!(turn1.role, "owner");
    assert_eq!(turn1.content, "hello");

    let turn2 = store
        .add_secretary_turn(
            conv_a.id,
            "secretary",
            "hi there",
            Some(r#"{"action":"test"}"#),
            Some(&turn1.id.to_string()),
        )
        .await
        .expect("add turn 2");
    assert_eq!(turn2.proposal_json.as_deref(), Some(r#"{"action":"test"}"#));
    assert_eq!(
        turn2.refs_owner_message.as_deref(),
        Some(turn1.id.to_string().as_str())
    );

    let turns = store
        .list_secretary_turns(conv_a.id)
        .await
        .expect("list turns");
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0], turn1);
    assert_eq!(turns[1], turn2);

    // Summary create + update
    assert!(store
        .get_secretary_summary(conv_a.id)
        .await
        .expect("get none")
        .is_none());

    store
        .set_secretary_summary(conv_a.id, "summary v1", turn1.id.to_string())
        .await
        .expect("set summary v1");
    let summary = store
        .get_secretary_summary(conv_a.id)
        .await
        .expect("get summary")
        .expect("exists");
    assert_eq!(summary.summary, "summary v1");
    assert_eq!(summary.covers_until, turn1.id.to_string());

    store
        .set_secretary_summary(conv_a.id, "summary v2", turn2.id.to_string())
        .await
        .expect("set summary v2");
    let summary2 = store
        .get_secretary_summary(conv_a.id)
        .await
        .expect("get summary 2")
        .expect("exists");
    assert_eq!(summary2.summary, "summary v2");
    assert_eq!(summary2.covers_until, turn2.id.to_string());
}
