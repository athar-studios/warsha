use super::*;

fn pairing(revoked: bool, expires_at: Option<u64>) -> PhonePairing {
    let mut pairing = PhonePairing::new_with_expiry(
        "11111111-1111-4111-8111-111111111111",
        "pair-repair-synthetic-secret",
        1_000,
        expires_at,
    );
    pairing.revoked = revoked;
    pairing
}

/// What `DaemonState::active_pairings` would hand the predicate at this clock.
fn active_set(pairings: &[PhonePairing]) -> Vec<PhonePairing> {
    pairings
        .iter()
        .filter(|pairing| pairing.is_active_at(now_epoch_secs()))
        .cloned()
        .collect()
}

fn paired_ext(device_id: &str) -> RpcExtensions {
    let mut ext = RpcExtensions::new();
    ext.insert(Actor::paired(&PhonePairing::new(
        device_id,
        "a-pairing-secret",
        1_700_000_000,
    )));
    ext
}

async fn seed_pairing(state: &DaemonState, device_id: &str) {
    state
        .pairings
        .write()
        .await
        .create_with_expiry(device_id, "a-pairing-secret", 1_700_000_000, None)
        .expect("the test pairing is recorded once");
}

#[test]
fn pairing_list_owner_only() {
    let policy = auth::policy_of("pairing.list").expect("the method has a policy");
    assert_eq!(
        policy.policy,
        Policy::Owner,
        "pairing.list returns other devices' secrets and must be owner-only"
    );
}

#[test]
fn ws_reauthorize() {
    let active = pairing(false, None);
    let actor = Actor::paired(&active);
    assert!(paired_device_is_active(&actor, &active_set(&[active])));
    assert!(!paired_device_is_active(
        &actor,
        &active_set(&[pairing(true, None)])
    ));
    assert!(!paired_device_is_active(
        &actor,
        &active_set(&[pairing(false, Some(1_001))])
    ));
    let owner = Actor::owner(DeviceId::new());
    assert!(paired_device_is_active(&owner, &[]));
}

#[tokio::test]
async fn ws_reauthorize_rejects_revoked_or_expired_device_rpc() {
    let dir = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(dir.path()).await;
    let rpc = WarshaRpc::new(state.clone());
    let device_id = "test-ws-reauth-phone";
    seed_pairing(&state, device_id).await;

    let paired = paired_ext(device_id);
    assert!(rpc.authorize(&paired, "health").await.is_ok());

    // Revoke the pairing:
    assert!(state.pairings.write().await.revoke(device_id).is_ok());
    let err = rpc.authorize(&paired, "health").await.unwrap_err();
    assert_eq!(err.code(), -32001);
    assert!(err.message().contains("needs a still-active pairing"));
}

#[test]
fn events_subscription_revoked() {
    let active = pairing(false, None);
    let actor = Actor::paired(&active);
    assert!(paired_device_is_active(&actor, &active_set(&[active])));
    assert!(!paired_device_is_active(
        &actor,
        &active_set(&[pairing(true, None)])
    ));
}

#[tokio::test]
async fn events_subscription_revoked_does_not_replay_since_seq() {
    let dir = crate::test_util::fresh_tempdir();
    let (state, _store) = crate::tests::test_state(dir.path()).await;
    let device_id = "test-events-revoked-phone";
    seed_pairing(&state, device_id).await;

    let event = Event {
        id: ulid::Ulid::new(),
        run_id: RunId::new(),
        stage: Stage::Idea,
        role: None,
        kind: EventKind::StageStarted,
        payload: serde_json::json!({ "test": "data" }),
        cost_cents: None,
        tokens: None,
        created_at: Utc::now(),
        device_id: None,
    };
    state.events.publish(event).await;
    assert_eq!(state.events.current_seq(), 1);

    // Active pairing: sync gives frames
    let sync_before = state.events.sync(0, None).await;
    assert_eq!(sync_before.frames.len(), 1);

    // Revoke device:
    assert!(state.pairings.write().await.revoke(device_id).is_ok());
    let paired = paired_ext(device_id);
    let active_set = state.active_pairings().await;
    assert!(!paired_device_is_active(
        paired.get::<Actor>().expect("actor"),
        &active_set
    ));
}

/// K5.6: transport dispatch on install/toggle/configure never spawns a non-stdio command.
mod k5_repair {
    use super::*;

    fn owner_ext() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn legacy_http_row(id: &str) -> StoredPlugin {
        StoredPlugin {
            id: id.to_string(),
            name: "Legacy HTTP".to_string(),
            description: "test".to_string(),
            transport: "http".to_string(),
            command: Some("sh".to_string()),
            args_json: serde_json::to_string(&vec!["-c", "sleep 5"]).expect("args json"),
            env_json: "{}".to_string(),
            enabled: false,
            tools_json: "[]".to_string(),
            source: "user".to_string(),
        }
    }

    #[tokio::test]
    async fn transport_bypass_install_refuses_http_with_command() {
        let dir = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(dir.path()).await;
        let rpc = WarshaRpc::new(state.clone());
        let bad = r#"{"name":"bad-http","transport":"http","command":"sh","args":["-c","id"]}"#;
        assert!(rpc
            .install_plugin(&owner_ext(), bad.to_string())
            .await
            .is_err());
        assert!(state.processes.list().await.is_empty());
    }

    #[tokio::test]
    async fn transport_bypass_toggle_never_spawns_non_stdio_command() {
        let dir = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(dir.path()).await;
        state
            .settings
            .save_plugin(&legacy_http_row("legacy-http-toggle"))
            .await
            .expect("seed legacy row");
        let rpc = WarshaRpc::new(state.clone());
        let toggled = rpc
            .toggle_plugin(&owner_ext(), "legacy-http-toggle".to_string(), true)
            .await
            .expect("toggle succeeds without spawning");
        assert!(toggled.enabled);
        assert!(state.processes.list().await.is_empty());
    }

    #[tokio::test]
    async fn transport_bypass_configure_never_spawns_non_stdio_command() {
        let dir = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(dir.path()).await;
        let mut row = legacy_http_row("legacy-http-cfg");
        row.enabled = true;
        state
            .settings
            .save_plugin(&row)
            .await
            .expect("seed legacy enabled row");
        let rpc = WarshaRpc::new(state.clone());
        let configured = rpc
            .configure_plugin(&owner_ext(), "legacy-http-cfg".to_string(), HashMap::new())
            .await
            .expect("configure succeeds without spawning");
        assert_eq!(configured.transport, "http");
        assert!(state.processes.list().await.is_empty());
    }
}

/// K6.2: the daemon RPC surface and the end-to-end table at the agent call site.
mod mcp_permission {
    use super::*;
    use warsha_pipeline::mcp_permission::ToolPermission;
    use warsha_pipeline::McpPermissionSource;

    fn owner_ext() -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::owner(DeviceId::new()));
        ext
    }

    fn paired_ext(device_id: &str) -> RpcExtensions {
        let mut ext = RpcExtensions::new();
        ext.insert(Actor::paired(&PhonePairing::new(
            device_id,
            "a-pairing-secret",
            1_700_000_000,
        )));
        ext
    }

    async fn seed_pairing(state: &DaemonState, device_id: &str) {
        state
            .pairings
            .write()
            .await
            .create_with_expiry(device_id, "a-pairing-secret", 1_700_000_000, None)
            .expect("the test pairing is recorded once");
    }

    fn rpc_error_code(error: &jsonrpsee::types::ErrorObjectOwned) -> i32 {
        error.code()
    }

    #[derive(Default)]
    struct RecordingMcp {
        calls: std::sync::Mutex<Vec<(String, String)>>,
        sends: std::sync::Mutex<Vec<(String, String)>>,
    }

    impl RecordingMcp {
        fn calls(&self) -> usize {
            self.calls.lock().expect("the recording lock").len()
        }

        fn sends(&self) -> Vec<(String, String)> {
            self.sends.lock().expect("the recording lock").clone()
        }
    }

    #[async_trait]
    impl McpManager for RecordingMcp {
        async fn connect(
            &self,
            _config: warsha_pipeline::mcp_transport::McpServerConfig,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn disconnect(
            &self,
            _name: &str,
        ) -> std::result::Result<(), warsha_pipeline::McpTransportError> {
            Ok(())
        }
        async fn list(&self) -> Vec<warsha_pipeline::McpConnection> {
            vec![warsha_pipeline::McpConnection {
                config: warsha_pipeline::mcp_transport::McpServerConfig {
                    name: "srv".to_string(),
                    transport: warsha_pipeline::mcp_transport::McpTransport::Stdio,
                    command: Some("dummy".to_string()),
                    args: vec![],
                },
                status: warsha_pipeline::McpStatus::Connected,
                process_id: Some("p1".to_string()),
                tools: vec!["tool".to_string()],
                tool_definitions: vec![],
            }]
        }
        async fn send(
            &self,
            name: &str,
            payload: &str,
        ) -> std::result::Result<String, warsha_pipeline::McpTransportError> {
            self.sends
                .lock()
                .expect("the recording lock")
                .push((name.to_string(), payload.to_string()));
            Ok(payload.to_string())
        }
        async fn call_tool(
            &self,
            name: &str,
            tool: &str,
            _arguments: serde_json::Value,
        ) -> std::result::Result<
            warsha_pipeline::mcp::McpToolResult,
            warsha_pipeline::McpTransportError,
        > {
            self.calls
                .lock()
                .expect("the recording lock")
                .push((name.to_string(), tool.to_string()));
            Ok(warsha_pipeline::mcp::McpToolResult {
                content: vec![warsha_pipeline::mcp::McpContent::Text {
                    text: "ok".to_string(),
                }],
                is_error: false,
            })
        }
    }

    fn approved_agent_loop(
        permissions: Arc<StaticPermissions>,
        mcp: Arc<RecordingMcp>,
    ) -> AgentLoop {
        let mut agent_loop = AgentLoop::new();
        agent_loop
            .approve_agent_mode("owner")
            .expect("an approval is accepted");
        agent_loop.with_mcp(mcp).with_mcp_permissions(permissions)
    }

    fn call_tool_input() -> String {
        "call mcp srv/tool {\"msg\":\"hi\"}".to_string()
    }

    #[tokio::test]
    async fn set_then_list_round_trips_and_memory_updates() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        let row = rpc
            .set_mcp_permission(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "allow".to_string(),
            )
            .await
            .expect("the owner sets a permission");
        assert_eq!(row.permission, "allow");

        let listed = rpc
            .list_mcp_permissions(&owner)
            .await
            .expect("the owner lists permissions");
        assert_eq!(listed.default_permission, "ask");
        assert_eq!(listed.agent_role, warsha_pipeline::MCP_AGENT_ROLE);
        assert_eq!(
            listed.rows,
            vec![McpPermissionRow {
                server: "srv".to_string(),
                tool: "tool".to_string(),
                role: warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                permission: "allow".to_string(),
            }]
        );
        // The running table changed with the store, before any restart.
        assert_eq!(
            rpc.state.mcp_permissions.check_permission(
                "srv",
                "tool",
                warsha_pipeline::MCP_AGENT_ROLE
            ),
            ToolPermission::Allow
        );
        // An unknown permission is rejected, not defaulted.
        assert!(rpc
            .set_mcp_permission(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "permit".to_string(),
            )
            .await
            .is_err());
    }

    #[tokio::test]
    async fn default_ask_blocks_the_agent_and_allow_lets_it_through() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();
        let mcp = Arc::new(RecordingMcp::default());
        let mut agent_loop = approved_agent_loop(rpc.state.mcp_permissions.clone(), mcp.clone());

        let blocked = agent_loop.run_turn(&call_tool_input(), &[]).await;
        assert!(
            !blocked.tools[0].success,
            "default Ask let the call through"
        );
        assert_eq!(mcp.calls(), 0, "default Ask reached the transport");
        assert_eq!(agent_loop.ask_queue.len(), 1);

        rpc.set_mcp_permission(
            &owner,
            "srv".to_string(),
            "tool".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the owner grants the tool");

        let allowed = agent_loop.run_turn(&call_tool_input(), &[]).await;
        assert!(
            allowed.tools[0].success,
            "allow did not let the call through"
        );
        assert_eq!(mcp.calls(), 1, "allow did not call exactly once");
    }

    #[tokio::test]
    async fn a_paired_device_is_refused_both_permission_rpcs() {
        let temp = crate::test_util::fresh_tempdir();
        let (state, _store) = crate::tests::test_state(temp.path()).await;
        let device = uuid::Uuid::new_v4().to_string();
        seed_pairing(&state, &device).await;
        let rpc = WarshaRpc::new(state);
        let paired = paired_ext(&device);

        let listed = rpc
            .list_mcp_permissions(&paired)
            .await
            .expect_err("a paired device listed the permission table");
        assert_eq!(rpc_error_code(&listed), auth::rpc_codes::FORBIDDEN);
        let set = rpc
            .set_mcp_permission(
                &paired,
                "srv".to_string(),
                "tool".to_string(),
                warsha_pipeline::MCP_AGENT_ROLE.to_string(),
                "allow".to_string(),
            )
            .await
            .expect_err("a paired device wrote a permission");
        assert_eq!(rpc_error_code(&set), auth::rpc_codes::FORBIDDEN);
    }

    /// A daemon whose MCP transport is a recorder, so a test can say whether the
    /// transport was reached at all — the property R-KEEL row 6 is about.
    async fn state_with_recording_mcp(data_dir: &Path, mcp: Arc<RecordingMcp>) -> Arc<DaemonState> {
        let (state, _store) = crate::tests::test_state_with_seams(
            data_dir,
            |_| {},
            None,
            None,
            Some(mcp as Arc<dyn McpManager>),
        )
        .await;
        state
    }

    #[tokio::test]
    async fn call_mcp_refuses_a_denied_tool_and_never_reaches_the_transport() {
        let temp = crate::test_util::fresh_tempdir();
        let mcp = Arc::new(RecordingMcp::default());
        let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();
        rpc.set_mcp_permission(
            &owner,
            "srv".to_string(),
            "tool".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "deny".to_string(),
        )
        .await
        .expect("the owner denies the tool");

        let err = rpc
            .call_mcp(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                serde_json::json!({}),
            )
            .await
            .expect_err("a denied tool must not be callable over RPC");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            err.message().contains("denied by MCP permission srv::tool"),
            "the refusal names the denied row, got: {}",
            err.message()
        );
        assert_eq!(mcp.calls(), 0, "a denied RPC call reached the transport");
    }

    #[tokio::test]
    async fn call_mcp_reaches_the_transport_once_when_allowed() {
        let temp = crate::test_util::fresh_tempdir();
        let mcp = Arc::new(RecordingMcp::default());
        let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();
        rpc.set_mcp_permission(
            &owner,
            "srv".to_string(),
            "tool".to_string(),
            warsha_pipeline::MCP_AGENT_ROLE.to_string(),
            "allow".to_string(),
        )
        .await
        .expect("the owner grants the tool");

        let result = rpc
            .call_mcp(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                serde_json::json!({ "msg": "hi" }),
            )
            .await
            .expect("an allowed tool is called");
        assert!(!result.is_error);
        assert_eq!(mcp.calls(), 1, "allow did not call exactly once");
    }

    #[tokio::test]
    async fn call_mcp_refuses_a_tool_with_no_row() {
        let temp = crate::test_util::fresh_tempdir();
        let mcp = Arc::new(RecordingMcp::default());
        let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        // No row: the table defaults to Ask, and there is no approval queue on this
        // path, so the honest answer is a refusal that names the grant to make.
        let err = rpc
            .call_mcp(
                &owner,
                "srv".to_string(),
                "tool".to_string(),
                serde_json::json!({}),
            )
            .await
            .expect_err("a tool with no row must not be called over RPC");
        assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
        assert!(
            err.message().contains("ask-gated") && err.message().contains("mcp.permissions.set"),
            "the refusal explains the default and the grant, got: {}",
            err.message()
        );
        assert_eq!(
            mcp.calls(),
            0,
            "an ask-gated RPC call reached the transport"
        );
    }

    #[tokio::test]
    async fn send_mcp_refuses_a_tools_call_frame_and_writes_any_other() {
        let temp = crate::test_util::fresh_tempdir();
        let mcp = Arc::new(RecordingMcp::default());
        let state = state_with_recording_mcp(temp.path(), mcp.clone()).await;
        let rpc = WarshaRpc::new(state);
        let owner = owner_ext();

        // Every spelling the child's parser would read as `tools/call`: the plain
        // frame, the JSON escape, and a second frame smuggled onto a later line.
        let refused_frames = [
            r#"{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"tool","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":8,"method":"tools\u002fcall","params":{}}"#,
            "{\"jsonrpc\":\"2.0\",\"id\":9,\"method\":\"tools/list\"}\n{\"jsonrpc\":\"2.0\",\"id\":10,\"method\":\"tools/call\",\"params\":{}}",
        ];
        for payload in refused_frames {
            let err = rpc
                .send_mcp(&owner, "srv".to_string(), payload.to_string())
                .await
                .expect_err("a tools/call frame must not be written");
            assert_eq!(rpc_error_code(&err), auth::rpc_codes::POLICY_REFUSED);
            assert!(
                err.message().contains("tools/call"),
                "the refusal names the governed method, got: {}",
                err.message()
            );
        }
        assert!(
            mcp.sends().is_empty(),
            "a refused frame reached the transport: {:?}",
            mcp.sends()
        );

        // Every other method is the caller's own protocol and passes unchanged.
        let frames = [
            r#"{"jsonrpc":"2.0","id":11,"method":"tools/list"}"#,
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        ];
        for payload in frames {
            assert_eq!(
                rpc.send_mcp(&owner, "srv".to_string(), payload.to_string())
                    .await
                    .expect("another method passes through"),
                payload
            );
        }
        assert_eq!(
            mcp.sends(),
            frames
                .iter()
                .map(|payload| ("srv".to_string(), payload.to_string()))
                .collect::<Vec<_>>(),
            "each allowed frame reaches the transport exactly once, unchanged"
        );
    }
}
