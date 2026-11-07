//! Wave 2 & Wave 3 JSON-RPC end-to-end integration test suite (F10).
//!
//! Validates all Wave 2 RPC surfaces over a live daemon socket/HTTP listener:
//! - `harness.*`: list, get, select, import, delete, active tracking (F1)
//! - `skills.*`: list, import, toggle, delete
//! - `plugins.*`: list, install, configure, toggle, remove
//! - `models.*`: list, add, remove
//! - `providers.test`: model resolution probe (D1) with fallback and explicit model
//! - `integrations.*`: list, connect, test (D3 credential validation), disconnect
//! - `files.*`: tree, read, and strict `../` path traversal refusal

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write as IoWrite};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;

use reqwest::Client;
use serde_json::{json, Value};
use tempfile::TempDir;
use warsha_core::harness::HarnessDefinition;
use warsha_providers::InMemorySecretStore;
use warshad::{start_daemon_with_secrets, DaemonConfig, DaemonHandle};

const TEST_TOKEN: &str = "wave2-rpc-test-token";

fn fresh_tempdir() -> TempDir {
    if let Some(base) = std::env::var_os("CARGO_TARGET_TMPDIR") {
        let base = PathBuf::from(base);
        if base.is_dir() {
            if let Ok(dir) = TempDir::new_in(&base) {
                return dir;
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(deps) = exe.parent() {
            let base = deps.join("tmp");
            if std::fs::create_dir_all(&base).is_ok() {
                if let Ok(dir) = TempDir::new_in(&base) {
                    return dir;
                }
            }
        }
    }
    TempDir::new().expect("tempdir for daemon")
}

struct Rpc {
    client: Client,
    rpc_port: u16,
}

impl Rpc {
    fn new(rpc_port: u16) -> Self {
        let client = Client::builder()
            .default_headers({
                let mut headers = reqwest::header::HeaderMap::new();
                headers.insert(
                    reqwest::header::AUTHORIZATION,
                    format!("Bearer {TEST_TOKEN}")
                        .parse()
                        .expect("a valid auth header"),
                );
                headers
            })
            .build()
            .expect("a reqwest client");
        Rpc { client, rpc_port }
    }

    async fn call(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        assert!(
            body.get("error").is_none(),
            "{method} failed: {}",
            body["error"]
        );
        body["result"].clone()
    }

    async fn call_refused(&self, method: &str, params: Value) -> Value {
        let body = self.post(method, params).await;
        assert!(
            body.get("error").is_some(),
            "{method} was expected to fail but answered result: {}",
            body["result"]
        );
        body["error"].clone()
    }

    async fn post(&self, method: &str, params: Value) -> Value {
        let response = self
            .client
            .post(format!("http://127.0.0.1:{}", self.rpc_port))
            .json(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": method,
                "params": params,
            }))
            .send()
            .await
            .expect("RPC request sent");
        assert_eq!(
            response.status(),
            reqwest::StatusCode::OK,
            "{method} answered HTTP {}",
            response.status()
        );
        response
            .json::<Value>()
            .await
            .expect("response is valid JSON")
    }
}

fn config(data_dir: &Path) -> DaemonConfig {
    DaemonConfig {
        data_dir: data_dir.to_path_buf(),
        socket_path: data_dir.join("warshad.sock"),
        http_port: 0,
        ws_port: 0,
        auth_token: TEST_TOKEN.to_string(),
        allowed_origins: vec!["http://localhost:5173".to_string()],
        ..DaemonConfig::default()
    }
}

async fn daemon_over(dir: &Path, secrets: Arc<InMemorySecretStore>) -> (DaemonHandle, Rpc) {
    std::fs::create_dir_all(dir).expect("data dir created");
    let handle = start_daemon_with_secrets(config(dir), secrets)
        .await
        .expect("daemon starts");
    let rpc = Rpc::new(handle.rpc_port());
    (handle, rpc)
}

struct StubEndpoint {
    base_url: String,
    #[allow(dead_code)]
    seen: Arc<Mutex<Vec<String>>>,
}

impl StubEndpoint {
    fn start(status: u16) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback port");
        let port = listener.local_addr().expect("bound address").port();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let captured = seen.clone();

        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let mut reader = BufReader::new(stream.try_clone().expect("cloned stream"));
                let mut line = String::new();
                let mut authorization = String::new();
                while reader.read_line(&mut line).is_ok() && line != "\r\n" {
                    if line.to_lowercase().starts_with("authorization:") {
                        authorization = line.trim().to_string();
                    }
                    line.clear();
                }
                captured.lock().expect("capture lock").push(authorization);

                let body = if status == 200 {
                    r#"{"data":[],"object":"list"}"#
                } else {
                    r#"{"error":"unauthorized"}"#
                };
                let response = format!(
                    "HTTP/1.1 {status} stub\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
            }
        });

        Self {
            base_url: format!("http://127.0.0.1:{port}/v1"),
            seen,
        }
    }
}

#[tokio::test]
async fn test_wave2_harness_rpc_lifecycle() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());
    let (handle, rpc) = daemon_over(&data_dir, secrets).await;

    // 1. harness.list returns bundled harnesses with active boolean populated
    let list = rpc.call("harness.list", json!([])).await;
    let harnesses: Vec<HarnessDefinition> =
        serde_json::from_value(list).expect("harness list parsed");
    assert!(!harnesses.is_empty(), "seeded harnesses exist");
    let factory = harnesses
        .iter()
        .find(|h| h.id == "autonomous-factory")
        .expect("autonomous-factory present");
    assert!(
        factory.active,
        "autonomous-factory is active by default (F1)"
    );

    // 2. harness.get returns harness with active populated
    let get_res = rpc
        .call("harness.get", json!({ "id": "autonomous-factory" }))
        .await;
    let got: HarnessDefinition = serde_json::from_value(get_res).expect("harness parsed");
    assert_eq!(got.id, "autonomous-factory");
    assert!(got.active);

    // 3. harness.select switches active harness
    rpc.call(
        "harness.select",
        json!({ "harness_id": "complex-workbench", "project_id": null }),
    )
    .await;
    let list_after_select: Vec<HarnessDefinition> =
        serde_json::from_value(rpc.call("harness.list", json!([])).await)
            .expect("harness list parsed");
    let workbench = list_after_select
        .iter()
        .find(|h| h.id == "complex-workbench")
        .expect("complex-workbench present");
    assert!(workbench.active, "complex-workbench is now active");
    let factory_after = list_after_select
        .iter()
        .find(|h| h.id == "autonomous-factory")
        .expect("autonomous-factory present");
    assert!(
        !factory_after.active,
        "autonomous-factory is no longer active"
    );

    // 4. harness.import imports a valid custom harness
    let custom_harness_json = json!({
        "id": "e2e-custom-harness",
        "name": "E2E Custom Harness",
        "version": "1.0.0",
        "stages": [
            { "id": "stage-plan", "role": "architect", "name": "Planning" },
            { "id": "stage-code", "role": "coder", "name": "Coding" }
        ]
    })
    .to_string();

    let imported: HarnessDefinition = serde_json::from_value(
        rpc.call(
            "harness.import",
            json!({ "content": custom_harness_json, "format": "json" }),
        )
        .await,
    )
    .expect("custom harness imported");
    assert_eq!(imported.id, "e2e-custom-harness");
    assert_eq!(imported.stages.len(), 2);

    // 5. harness.delete refuses to delete bundled presets
    let delete_preset_err = rpc
        .call_refused("harness.delete", json!({ "id": "autonomous-factory" }))
        .await;
    assert!(
        delete_preset_err["message"]
            .as_str()
            .unwrap_or_default()
            .contains("bundled harness"),
        "must refuse preset deletion"
    );

    // 6. harness.delete succeeds for imported harness
    rpc.call("harness.delete", json!({ "id": "e2e-custom-harness" }))
        .await;
    let get_deleted_err = rpc
        .call_refused("harness.get", json!({ "id": "e2e-custom-harness" }))
        .await;
    assert!(get_deleted_err["message"]
        .as_str()
        .unwrap_or_default()
        .contains("no harness"));

    handle.shutdown().await;
}

#[tokio::test]
async fn test_wave2_skills_and_plugins_rpc_lifecycle() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());
    let (handle, rpc) = daemon_over(&data_dir, secrets).await;

    // --- SKILLS ---
    // 1. skills.list lists seeded/bundled skills
    let skills_list = rpc.call("skills.list", json!([])).await;
    let skills = skills_list.as_array().expect("array of skills");
    assert!(!skills.is_empty(), "bundled skills present");

    // 2. skills.import imports a custom skill
    let custom_skill_json = json!({
        "id": "e2e-test-skill",
        "name": "E2E Test Skill",
        "description": "A skill for testing",
        "category": "testing",
        "content": "Test skill system instructions"
    })
    .to_string();

    let imported_skill = rpc
        .call(
            "skills.import",
            json!({ "url_or_content": custom_skill_json, "name": "E2E Test Skill" }),
        )
        .await;
    assert_eq!(imported_skill["id"], "e2e-test-skill");
    assert_eq!(imported_skill["enabled"], true);

    // 3. skills.toggle toggles enabled state
    let toggled_off = rpc
        .call(
            "skills.toggle",
            json!({ "id": "e2e-test-skill", "enabled": false }),
        )
        .await;
    assert_eq!(toggled_off["enabled"], false);

    let toggled_on = rpc
        .call(
            "skills.toggle",
            json!({ "id": "e2e-test-skill", "enabled": true }),
        )
        .await;
    assert_eq!(toggled_on["enabled"], true);

    // 4. skills.delete removes the skill
    rpc.call("skills.delete", json!({ "id": "e2e-test-skill" }))
        .await;
    let skills_after_delete = rpc.call("skills.list", json!([])).await;
    let remaining_ids: Vec<String> = skills_after_delete
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|s| s["id"].as_str().map(String::from))
        .collect();
    assert!(!remaining_ids.contains(&"e2e-test-skill".to_string()));

    // --- PLUGINS ---
    // 5. plugins.list
    let plugins_list = rpc.call("plugins.list", json!([])).await;
    assert!(plugins_list.is_array());

    // 6. plugins.install installs a plugin manifest
    let plugin_manifest = json!({
        "id": "e2e-test-plugin",
        "name": "E2E Test Plugin",
        "description": "MCP pack test",
        "transport": "http",
        "command": null,
        "args": [],
        "env": { "PORT": "9000" },
        "enabled": false,
        "tools": []
    })
    .to_string();

    let installed_plugin = rpc
        .call(
            "plugins.install",
            json!({ "manifest_json_or_url": plugin_manifest }),
        )
        .await;
    assert_eq!(installed_plugin["id"], "e2e-test-plugin");

    // 7. plugins.configure updates plugin env
    let mut new_env = HashMap::new();
    new_env.insert("SECRET_KEY".to_string(), "token-val".to_string());
    new_env.insert("HOST".to_string(), "127.0.0.1".to_string());

    let configured_plugin = rpc
        .call(
            "plugins.configure",
            json!({ "id": "e2e-test-plugin", "env": new_env }),
        )
        .await;
    assert_eq!(configured_plugin["id"], "e2e-test-plugin");

    // 8. plugins.toggle toggles enabled state
    let toggled_plugin_on = rpc
        .call(
            "plugins.toggle",
            json!({ "id": "e2e-test-plugin", "enabled": true }),
        )
        .await;
    assert_eq!(toggled_plugin_on["enabled"], true);

    let toggled_plugin_off = rpc
        .call(
            "plugins.toggle",
            json!({ "id": "e2e-test-plugin", "enabled": false }),
        )
        .await;
    assert_eq!(toggled_plugin_off["enabled"], false);

    // 9. plugins.remove removes plugin
    rpc.call("plugins.remove", json!({ "id": "e2e-test-plugin" }))
        .await;
    let plugins_after_remove = rpc.call("plugins.list", json!([])).await;
    let remaining_plugin_ids: Vec<String> = plugins_after_remove
        .as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|p| p["id"].as_str().map(String::from))
        .collect();
    assert!(!remaining_plugin_ids.contains(&"e2e-test-plugin".to_string()));

    handle.shutdown().await;
}

#[tokio::test]
async fn test_wave2_models_and_providers_test_rpc() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());
    let endpoint = StubEndpoint::start(200);
    let (handle, rpc) = daemon_over(&data_dir, secrets.clone()).await;

    // --- MODELS ---
    // 1. models.add registers custom model
    let added_model = rpc
        .call(
            "models.add",
            json!({
                "provider": "custom-openai",
                "model_id": "custom-gpt-5",
                "display_name": "Custom GPT-5",
                "context_window": 128000
            }),
        )
        .await;
    assert_eq!(added_model["provider"], "custom-openai");
    assert_eq!(added_model["model_id"], "custom-gpt-5");
    assert_eq!(added_model["display_name"], "Custom GPT-5");
    assert_eq!(added_model["context_window"], 128000);

    // 2. models.list filters by provider
    let list_for_provider = rpc
        .call("models.list", json!({ "provider": "custom-openai" }))
        .await;
    let model_rows = list_for_provider.as_array().expect("array of models");
    assert_eq!(model_rows.len(), 1);
    assert_eq!(model_rows[0]["model_id"], "custom-gpt-5");

    let list_for_other = rpc
        .call("models.list", json!({ "provider": "non-existent" }))
        .await;
    assert!(list_for_other.as_array().expect("empty array").is_empty());

    // 3. models.remove
    rpc.call(
        "models.remove",
        json!({
            "provider": "custom-openai",
            "model_id": "custom-gpt-5"
        }),
    )
    .await;
    let list_after_remove = rpc
        .call("models.list", json!({ "provider": "custom-openai" }))
        .await;
    assert!(list_after_remove
        .as_array()
        .expect("empty array")
        .is_empty());

    // --- PROVIDERS.TEST (D1 Probe Model Resolution) ---
    // Add custom provider
    let add_prov_res = rpc
        .call(
            "providers.add",
            json!({
                "name": "my-custom-endpoint",
                "kind": "custom",
                "key": "sk-test-secret-12345",
                "api_base": endpoint.base_url
            }),
        )
        .await;
    assert_eq!(add_prov_res["name"], "my-custom-endpoint");

    // 4. providers.test without explicit model:
    // Should resolve probe model automatically via D1 fallbacks (e.g. gpt-4o-mini for custom)
    // and succeed against StubEndpoint(200)
    let test_res_default = rpc
        .call("providers.test", json!({ "name": "my-custom-endpoint" }))
        .await;
    assert_eq!(test_res_default["healthy"], true);

    // 5. providers.test with explicit model:
    let test_res_explicit = rpc
        .call(
            "providers.test",
            json!({
                "name": "my-custom-endpoint",
                "model": "gpt-4o-mini-test"
            }),
        )
        .await;
    assert_eq!(test_res_explicit["healthy"], true);

    handle.shutdown().await;
}

#[tokio::test]
async fn test_wave2_integrations_rpc_and_credential_validation() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());
    let (handle, rpc) = daemon_over(&data_dir, secrets).await;

    // 1. integrations.list
    let list_res = rpc.call("integrations.list", json!([])).await;
    assert!(list_res.is_array());

    // 2. integrations.connect GitHub with token
    let gh_connect = rpc
        .call(
            "integrations.connect",
            json!({
                "id": "github",
                "config": {
                    "token": "ghp_mock_token_1234567890",
                    "owner": "test-owner"
                }
            }),
        )
        .await;
    assert_eq!(gh_connect["id"], "github");
    assert_eq!(gh_connect["connected"], true);

    // 3. integrations.test GitHub (D3: requires only has_token) -> status "ok"
    let gh_test = rpc
        .call("integrations.test", json!({ "id": "github" }))
        .await;
    assert_eq!(gh_test["status"], "ok");

    // 4. integrations.connect Slack with webhook URL only
    let slack_connect = rpc
        .call(
            "integrations.connect",
            json!({
                "id": "slack",
                "config": {
                    "webhook_url": "https://hooks.slack.com/services/T00/B00/XXXX"
                }
            }),
        )
        .await;
    assert_eq!(slack_connect["id"], "slack");
    assert_eq!(slack_connect["connected"], true);

    // 5. integrations.test Slack (D3: requires has_webhook || has_bot) -> status "ok"
    let slack_test = rpc
        .call("integrations.test", json!({ "id": "slack" }))
        .await;
    assert_eq!(slack_test["status"], "ok");

    // 6. integrations.connect unconfigured generic service
    let unconfigured_connect = rpc
        .call(
            "integrations.connect",
            json!({
                "id": "custom-ci",
                "config": {}
            }),
        )
        .await;
    assert_eq!(unconfigured_connect["id"], "custom-ci");

    // 7. integrations.test generic service without credentials -> status "unconfigured"
    let generic_test = rpc
        .call("integrations.test", json!({ "id": "custom-ci" }))
        .await;
    assert_eq!(generic_test["status"], "unconfigured");

    // 8. integrations.disconnect clears configured state
    let gh_disconnect = rpc
        .call("integrations.disconnect", json!({ "id": "github" }))
        .await;
    assert_eq!(gh_disconnect["id"], "github");
    assert_eq!(gh_disconnect["connected"], false);

    let gh_test_after_disconnect = rpc
        .call("integrations.test", json!({ "id": "github" }))
        .await;
    assert_eq!(gh_test_after_disconnect["status"], "unconfigured");

    handle.shutdown().await;
}

#[tokio::test]
async fn test_wave2_files_rpc_tree_read_and_traversal_rejection() {
    let dir = fresh_tempdir();
    let data_dir = dir.path().join("data");
    let secrets = Arc::new(InMemorySecretStore::new());

    // Prepare files in project directory: <data_dir>/files/test-project/
    let project_dir = data_dir.join("files").join("test-project");
    std::fs::create_dir_all(&project_dir).expect("project dir created");
    let sample_file = project_dir.join("sample.txt");
    std::fs::write(&sample_file, "Hello Warsha Files Tree and Read!").expect("sample file written");

    // A secret outside the project directory
    let outside_secret = data_dir.join("outside_secret.txt");
    std::fs::write(&outside_secret, "LEAKED_SECRET_NOT_ALLOWED").expect("outside secret written");

    let (handle, rpc) = daemon_over(&data_dir, secrets).await;

    // 1. files.tree lists files inside project
    let tree = rpc
        .call(
            "files.tree",
            json!({ "project_id": "test-project", "path": null }),
        )
        .await;
    let entries = tree.as_array().expect("array of file entries");
    assert!(!entries.is_empty(), "tree has entries");
    let sample_entry = entries
        .iter()
        .find(|e| e["name"] == "sample.txt")
        .expect("sample.txt listed");
    assert_eq!(sample_entry["is_dir"], false);

    // 2. files.read reads file content inside project
    let content_res = rpc
        .call(
            "files.read",
            json!({ "project_id": "test-project", "path": "sample.txt" }),
        )
        .await;
    assert_eq!(content_res["path"], "sample.txt");
    assert_eq!(content_res["content"], "Hello Warsha Files Tree and Read!");

    // 3. files.read rejects path traversal `../outside_secret.txt`
    let read_traversal_err = rpc
        .call_refused(
            "files.read",
            json!({ "project_id": "test-project", "path": "../outside_secret.txt" }),
        )
        .await;
    assert!(
        read_traversal_err["message"]
            .as_str()
            .unwrap_or_default()
            .contains("climbs out of the project"),
        "must refuse traversal with .."
    );

    // 4. files.read rejects deeper traversal `../../outside_secret.txt`
    let read_deep_traversal_err = rpc
        .call_refused(
            "files.read",
            json!({ "project_id": "test-project", "path": "../../outside_secret.txt" }),
        )
        .await;
    assert!(
        read_deep_traversal_err["message"]
            .as_str()
            .unwrap_or_default()
            .contains("climbs out of the project"),
        "must refuse deep traversal with .."
    );

    // 5. files.tree rejects path traversal `../`
    let tree_traversal_err = rpc
        .call_refused(
            "files.tree",
            json!({ "project_id": "test-project", "path": "../" }),
        )
        .await;
    assert!(
        tree_traversal_err["message"]
            .as_str()
            .unwrap_or_default()
            .contains("climbs out of the project"),
        "must refuse tree traversal with .."
    );

    handle.shutdown().await;
}
