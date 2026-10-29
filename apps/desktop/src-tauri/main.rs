//! Warsha Desktop — Tauri 2 app with sidecar warshad

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;
use warshad::{DaemonConfig, DaemonHandle, start_daemon};

/// Sidecar state to manage the warshad process
struct SidecarState {
    handle: Arc<Mutex<Option<DaemonHandle>>>,
    config: DaemonConfig,
}

#[tauri::command]
async fn start_sidecar(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut handle_guard = state.handle.lock().await;
    
    if handle_guard.is_some() {
        return Ok("Sidecar already running".to_string());
    }

    let handle = start_daemon(state.config.clone())
        .await
        .map_err(|e| format!("Failed to start daemon: {}", e))?;

    let http_port = handle.http_port();
    let rpc_port = handle.rpc_port();
    
    *handle_guard = Some(handle);
    
    Ok(format!("Sidecar started on HTTP: {}, RPC: {}", http_port, rpc_port))
}

#[tauri::command]
async fn stop_sidecar(state: State<'_, SidecarState>) -> Result<String, String> {
    let mut handle_guard = state.handle.lock().await;
    
    if let Some(handle) = handle_guard.take() {
        handle.shutdown().await.map_err(|e| format!("Failed to shutdown: {}", e))?;
        Ok("Sidecar stopped".to_string())
    } else {
        Ok("Sidecar not running".to_string())
    }
}

#[tauri::command]
async fn get_sidecar_status(state: State<'_, SidecarState>) -> Result<SidecarStatus, String> {
    let handle_guard = state.handle.lock().await;
    
    if let Some(handle) = handle_guard.as_ref() {
        Ok(SidecarStatus {
            running: true,
            http_port: Some(handle.http_port()),
            rpc_port: Some(handle.rpc_port()),
        })
    } else {
        Ok(SidecarStatus {
            running: false,
            http_port: None,
            rpc_port: None,
        })
    }
}

#[derive(serde::Serialize)]
struct SidecarStatus {
    running: bool,
    http_port: Option<u16>,
    rpc_port: Option<u16>,
}

#[tauri::command]
async fn open_external(url: String) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        if let Err(e) = open::that(url) {
            eprintln!("Failed to open URL: {}", e);
        }
    });
    Ok(())
}

fn get_config_dir() -> PathBuf {
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("warsha")
}

fn main() {
    let config_dir = get_config_dir();
    std::fs::create_dir_all(&config_dir).expect("Failed to create config dir");
    
    let db_path = config_dir.join("warsha.db");
    let config = DaemonConfig {
        data_dir: config_dir.clone(),
        http_port: 0, // OS chooses
        rpc_port: 0,  // OS chooses
        auth_token: None, // Will be generated
    };

    let sidecar_state = SidecarState {
        handle: Arc::new(Mutex::new(None)),
        config,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(sidecar_state)
        .invoke_handler(tauri::generate_handler![
            start_sidecar,
            stop_sidecar,
            get_sidecar_status,
            open_external
        ])
        .setup(|app| {
            // Auto-start sidecar on app launch
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state: State<'_, SidecarState> = handle.state();
                let _ = start_sidecar(state).await;
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Don't close the app, just hide the window
                window.hide().unwrap();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}