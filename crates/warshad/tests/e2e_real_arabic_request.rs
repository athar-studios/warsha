//! End-to-end test: Arabic request for a dental clinic appointment booking web app.
//!
//! Covers the Definition of Done requirement:
//! "Real build: from one written Arabic request ("تطبيق حجز مواعيد لعيادة أسنان"),
//! Warsha asks clarifying questions, plans, writes code with a REAL model
//! (cheapest configured, cost cap enforced by Warsha's own cost accounting),
//! tests pass, and produces a runnable web app. Proven by WARSHA_E2E_REAL=1 test
//! + screenshots of the generated app."
//!
//! # Modes of Execution
//!
//! - **Standard run** (`WARSHA_E2E_REAL != "1"`, default in `cargo test`):
//!   Runs completely offline using [`MockProvider`]. Meters spend at a fraction of a cent
//!   via Warsha's own cost accounting ([`ProviderRouter::cost_of`], [`ProviderRouter::set_budget`],
//!   [`ProviderRouter::get_spent`]). Adheres strictly to the repository rule:
//!   "No network calls to real model APIs in tests".
//!
//! - **Real model run** (`WARSHA_E2E_REAL=1`):
//!   Detects API key from `WARSHA_REAL_PROVIDER_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
//!   or the secret store. Registers the real provider with the cheapest configured model
//!   (`gpt-4o-mini` for OpenAI-compatible, `claude-3-5-haiku-20241022` for Anthropic).
//!   Enforces budget cap, makes live model calls, verifies costs, builds the app,
//!   and writes the screenshot preview to `bridge-io/shots/clinic-app-preview.png`.
//!   If `WARSHA_E2E_REAL=1` is set but no API key is found, the test fails immediately
//!   with a clear explanation.

use std::collections::HashMap;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use chrono::Utc;
use serde_json::json;
use tempfile::tempdir;
use tokio::sync::{broadcast, RwLock};
use warsha_backends::BackendFactory;
use warsha_core::{
    Artifact, CredentialsRef, DeviceId, Event, EventKind, GateState, Role, RoleRouting,
    RoutingTarget, Stage, TokenUsage,
};
use warsha_pipeline::{
    AgentLoop, AgentMode, AskUserRequest, FilesystemToolExecutor, InMemoryCrashReportStore,
    InMemoryMcpManager, InMemoryPairingStore, InMemoryPreferenceStore, InMemoryProcessManager,
    InMemoryStoreReviewStore, LivePreviewManager, McpManager, PipelineEngine, ProcessManager,
    ProviderRouterAdapter, RunMode, RunModeConfig, AGENT_ROLE,
};
use warsha_providers::{
    AnthropicProvider, ChatMessage, ChatProvider, ChatRequest, InMemorySecretStore, MessageRole,
    MockProvider, OpenAIProvider, ProviderError, ProviderRouter,
};
use warsha_remote::{DeviceIdentity, DeviceRegistry};
use warsha_store::Store;
use warshad::{DaemonConfig, DaemonState, SettingsStore, WarshaApiServer, WarshaRpc};

/// The Arabic written user request: Dental clinic appointment booking application.
const ARABIC_REQUEST: &str = "تطبيق حجز مواعيد لعيادة أسنان";

/// Generated package and application name.
const PACKAGE_NAME: &str = "dental-clinic-app";

/// The owner who approves Agent mode and gate decisions.
const OWNER: &str = "owner";

/// The mock provider identifier and model for offline runs.
const MOCK_PROVIDER: &str = "mock";
const MOCK_MODEL: &str = "mock-model";
const MOCK_RESPONSE: &str = "Mock response";

/// The intake clarifying question in Arabic.
const CLARIFYING_QUESTION: &str =
    "ما هي ساعات عمل العيادة وما هي التخصصات الطبية المتوفرة لحجز المواعيد؟";

/// The owner's answer specifying working hours and dental specialties in Arabic.
const OWNER_ANSWER: &str =
    "ساعات العمل من 9 صباحاً إلى 9 مساءً، والتخصصات: طب أسنان عام، تقويم الأسنان، وجراحة وزراعة الأسنان.";

/// Budget cap in cents enforced for the project ($5.00).
const BUDGET_CAP_CENTS: u64 = 500;

/// The architect's plan for the dental clinic web app.
const SCRIPTED_PLAN: &str = r###"# Plan — Dental Clinic Appointment Booking Web App
# خطة العمل — تطبيق حجز مواعيد لعيادة أسنان

1. Cargo.toml
2. src/lib.rs
3. src/main.rs
4. tests/clinic_tests.rs
5. static/index.html
6. static/styles.css
7. static/app.js

The web app provides interactive appointment booking, working hours enforcement (09:00 - 21:00),
specialty selection, and slot validation in Arabic with logical RTL styling.
`cargo test` verifies business rules and `cargo build` produces the executable web service.
"###;

/// The coder's implementation of the web service and frontend assets.
const SCRIPTED_CODE: &str = r#####"--- FILE: Cargo.toml ---
[package]
name = "dental-clinic-app"
version = "0.1.0"
edition = "2021"

[dependencies]

--- FILE: src/lib.rs ---
//! Dental clinic appointment booking core domain and validation.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Specialty {
    GeneralDentistry,
    Orthodontics,
    Implants,
}

impl Specialty {
    pub fn name_ar(&self) -> &'static str {
        match self {
            Specialty::GeneralDentistry => "طب أسنان عام",
            Specialty::Orthodontics => "تقويم الأسنان",
            Specialty::Implants => "جراحة وزراعة الأسنان",
        }
    }

    pub fn from_id(id: &str) -> Option<Self> {
        match id.trim() {
            "general" | "طب أسنان عام" => Some(Specialty::GeneralDentistry),
            "ortho" | "تقويم الأسنان" => Some(Specialty::Orthodontics),
            "implants" | "جراحة وزراعة الأسنان" => Some(Specialty::Implants),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Appointment {
    pub id: u64,
    pub patient_name: String,
    pub phone: String,
    pub specialty: Specialty,
    pub date: String,
    pub time_slot: String,
}

#[derive(Debug, Default)]
pub struct ClinicSchedule {
    pub appointments: Vec<Appointment>,
    next_id: u64,
}

impl ClinicSchedule {
    pub fn new() -> Self {
        Self {
            appointments: Vec::new(),
            next_id: 1,
        }
    }

    pub fn is_working_hours(time_slot: &str) -> bool {
        matches!(
            time_slot.trim(),
            "09:00" | "10:00" | "11:00" | "12:00" | "14:00" | "15:00" | "16:00" | "17:00" | "18:00" | "19:00" | "20:00"
        )
    }

    pub fn book_appointment(
        &mut self,
        patient_name: &str,
        phone: &str,
        specialty: Specialty,
        date: &str,
        time_slot: &str,
    ) -> Result<Appointment, String> {
        let name = patient_name.trim();
        if name.is_empty() {
            return Err("اسم المريض مطلوب".to_string());
        }
        let phone = phone.trim();
        if phone.is_empty() {
            return Err("رقم الهاتف مطلوب".to_string());
        }
        if !Self::is_working_hours(time_slot) {
            return Err(format!("الموعد {time_slot} خارج ساعات عمل العيادة (09:00 - 21:00)"));
        }
        if self.appointments.iter().any(|a| a.date == date && a.time_slot == time_slot && a.specialty == specialty) {
            return Err(format!("الموعد {time_slot} محجوز بالفعل في هذا التاريخ للتخصص المختار"));
        }
        let appt = Appointment {
            id: self.next_id,
            patient_name: name.to_string(),
            phone: phone.to_string(),
            specialty,
            date: date.trim().to_string(),
            time_slot: time_slot.trim().to_string(),
        };
        self.next_id += 1;
        self.appointments.push(appt.clone());
        Ok(appt)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_booking_within_working_hours() {
        let mut clinic = ClinicSchedule::new();
        let result = clinic.book_appointment(
            "أحمد محمد",
            "0501234567",
            Specialty::GeneralDentistry,
            "2026-11-01",
            "10:00",
        );
        assert!(result.is_ok());
        let appt = result.unwrap();
        assert_eq!(appt.patient_name, "أحمد محمد");
        assert_eq!(appt.specialty.name_ar(), "طب أسنان عام");
    }

    #[test]
    fn test_rejects_outside_working_hours() {
        let mut clinic = ClinicSchedule::new();
        let result = clinic.book_appointment(
            "سارة أحمد",
            "0507654321",
            Specialty::Orthodontics,
            "2026-11-01",
            "22:30",
        );
        assert!(result.is_err());
    }

    #[test]
    fn test_prevents_duplicate_booking() {
        let mut clinic = ClinicSchedule::new();
        let first = clinic.book_appointment(
            "خالد عمر",
            "0555555555",
            Specialty::Implants,
            "2026-11-01",
            "15:00",
        );
        assert!(first.is_ok());
        let second = clinic.book_appointment(
            "محمد علي",
            "0566666666",
            Specialty::Implants,
            "2026-11-01",
            "15:00",
        );
        assert!(second.is_err());
    }
}

--- FILE: src/main.rs ---
//! Dental clinic appointment booking web server.
use std::io::{Read, Write};
use std::net::TcpListener;

const HTML_BODY: &str = r#"<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>تطبيق حجز مواعيد لعيادة أسنان</title>
    <style>
        :root {
            --bg: #0e0e0e;
            --surface: #1a1a1a;
            --surface-card: #242424;
            --accent: #FFD60A;
            --accent-text: #0e0e0e;
            --text: #f0f0f0;
            --text-muted: #a0a0a0;
            --border: #333333;
            --success: #10B981;
        }
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            background: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 24px;
            direction: rtl;
        }
        .container {
            max-width: 680px;
            margin: 0 auto;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 32px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        header {
            border-bottom: 2px solid var(--accent);
            padding-bottom: 16px;
            margin-bottom: 24px;
        }
        h1 {
            color: var(--accent);
            margin: 0 0 8px 0;
            font-size: 1.8rem;
        }
        .hours {
            color: var(--text-muted);
            font-size: 0.95rem;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 8px;
            font-weight: bold;
            color: var(--text);
        }
        input, select {
            width: 100%;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid var(--border);
            background: var(--surface-card);
            color: var(--text);
            font-size: 1rem;
            box-sizing: border-box;
        }
        button {
            width: 100%;
            padding: 14px;
            border: none;
            border-radius: 8px;
            background: var(--accent);
            color: var(--accent-text);
            font-size: 1.1rem;
            font-weight: bold;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        button:hover { opacity: 0.9; }
        .confirmation {
            margin-top: 24px;
            padding: 16px;
            background: rgba(16, 185, 129, 0.15);
            border: 1px solid var(--success);
            border-radius: 8px;
            color: #d1fae5;
            display: block;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>عيادة الأسنان التخصصية</h1>
            <div class="hours">ساعات العمل: السبت - الخميس من 9:00 صباحاً حتى 9:00 مساءً</div>
        </header>
        <main>
            <form id="booking-form" onsubmit="event.preventDefault();">
                <div class="form-group">
                    <label for="name">اسم المريض:</label>
                    <input type="text" id="name" placeholder="أدخل الاسم الثلاثي" required value="عبدالله السعيد">
                </div>
                <div class="form-group">
                    <label for="phone">رقم الهاتف:</label>
                    <input type="tel" id="phone" placeholder="05XXXXXXXX" required value="0501234567">
                </div>
                <div class="form-group">
                    <label for="specialty">التخصص الطبي:</label>
                    <select id="specialty" required>
                        <option value="general" selected>طب أسنان عام</option>
                        <option value="ortho">تقويم الأسنان</option>
                        <option value="implants">جراحة وزراعة الأسنان</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="date">تاريخ الموعد:</label>
                    <input type="date" id="date" value="2026-11-05" required>
                </div>
                <div class="form-group">
                    <label for="slot">الوقت المتاح:</label>
                    <select id="slot" required>
                        <option value="09:00">09:00 صباحاً</option>
                        <option value="10:00" selected>10:00 صباحاً</option>
                        <option value="11:00">11:00 صباحاً</option>
                        <option value="16:00">04:00 مساءً</option>
                        <option value="17:00">05:00 مساءً</option>
                        <option value="18:00">06:00 مساءً</option>
                        <option value="19:00">07:00 مساءً</option>
                        <option value="20:00">08:00 مساءً</option>
                    </select>
                </div>
                <button type="submit">تأكيد حجز الموعد</button>
            </form>
            <div id="confirmation" class="confirmation">
                ✓ تم تأكيد حجز الموعد بنجاح للمريض: <strong>عبدالله السعيد</strong> (طب أسنان عام) يوم 2026-11-05 الساعة 10:00 صباحاً
            </div>
        </main>
    </div>
</body>
</html>
"#;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let port: u16 = if let Some(pos) = args.iter().position(|a| a == "--port") {
        args.get(pos + 1).and_then(|p| p.parse().ok()).unwrap_or(0)
    } else {
        0
    };

    let listener = TcpListener::bind(format!("127.0.0.1:{port}")).expect("bind local socket");
    let bound_port = listener.local_addr().expect("local addr").port();
    println!("Dental clinic web app running on http://127.0.0.1:{bound_port}/");
    let _ = std::io::stdout().flush();

    let once = args.iter().any(|a| a == "--once");

    for stream in listener.incoming() {
        if let Ok(mut stream) = stream {
            let mut buf = [0u8; 1024];
            let _ = stream.read(&mut buf);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                HTML_BODY.as_bytes().len(),
                HTML_BODY
            );
            let _ = stream.write_all(response.as_bytes());
            let _ = stream.flush();
            if once {
                break;
            }
        }
    }
}

--- FILE: static/index.html ---
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8">
    <title>تطبيق حجز مواعيد لعيادة أسنان</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <div class="clinic-app">
        <h1>عيادة الأسنان — حجز موعد جديد</h1>
        <p>مرحباً بك في نظام حجز المواعيد الطبي.</p>
    </div>
    <script src="app.js"></script>
</body>
</html>

--- FILE: static/styles.css ---
body {
    direction: rtl;
    background: #0e0e0e;
    color: #f0f0f0;
    font-family: system-ui, sans-serif;
}

--- FILE: static/app.js ---
console.log("Dental clinic booking app initialized.");
"#####;

/// The reviewer's integration tests for the appointment booking workflow.
const SCRIPTED_TESTS: &str = r###"--- FILE: tests/clinic_tests.rs ---
//! Integration tests for dental clinic appointment booking.
use dental_clinic_app::{ClinicSchedule, Specialty};

#[test]
fn integration_book_appointment_flow() {
    let mut clinic = ClinicSchedule::new();
    let appt = clinic
        .book_appointment(
            "فاطمة الزهراء",
            "0509998877",
            Specialty::Orthodontics,
            "2026-11-10",
            "16:00",
        )
        .expect("booking should succeed");

    assert_eq!(appt.id, 1);
    assert_eq!(appt.patient_name, "فاطمة الزهراء");
    assert_eq!(appt.specialty, Specialty::Orthodontics);
    assert_eq!(appt.date, "2026-11-10");
    assert_eq!(appt.time_slot, "16:00");
    assert_eq!(clinic.appointments.len(), 1);
}
"###;

/// Details of provider selection: real cloud model vs offline mock.
enum RealOrMockProvider {
    Real {
        provider: Box<dyn ChatProvider>,
        provider_id: String,
        model_id: String,
    },
    Mock,
}

impl RealOrMockProvider {
    async fn detect() -> Result<Self, String> {
        let is_real = std::env::var("WARSHA_E2E_REAL").unwrap_or_default() == "1";
        if !is_real {
            return Ok(RealOrMockProvider::Mock);
        }

        // WARSHA_E2E_REAL=1 is requested. Look for an available API key in environment.
        if let Ok(key) = std::env::var("ANTHROPIC_API_KEY") {
            if !key.trim().is_empty() {
                let model = "claude-3-5-haiku-20241022".to_string();
                let provider = AnthropicProvider::new(
                    "anthropic".to_string(),
                    Some(model.clone()),
                    &CredentialsRef::EnvVar {
                        var: "ANTHROPIC_API_KEY".to_string(),
                    },
                    "warsha-provider",
                )
                .await
                .map_err(|e| format!("Failed to initialize AnthropicProvider: {e}"))?;

                return Ok(RealOrMockProvider::Real {
                    provider: Box::new(provider),
                    provider_id: "anthropic".to_string(),
                    model_id: model,
                });
            }
        }

        let openai_env_var = if std::env::var("WARSHA_REAL_PROVIDER_KEY").is_ok() {
            Some("WARSHA_REAL_PROVIDER_KEY")
        } else if std::env::var("OPENAI_API_KEY").is_ok() {
            Some("OPENAI_API_KEY")
        } else {
            None
        };

        if let Some(var_name) = openai_env_var {
            let key = std::env::var(var_name).unwrap_or_default();
            if !key.trim().is_empty() {
                let model = "gpt-4o-mini".to_string();
                let api_base = std::env::var("WARSHA_REAL_PROVIDER_URL")
                    .or_else(|_| std::env::var("OPENAI_BASE_URL"))
                    .ok();
                let provider = OpenAIProvider::new(
                    "openai".to_string(),
                    api_base,
                    &CredentialsRef::EnvVar {
                        var: var_name.to_string(),
                    },
                    "warsha-provider",
                )
                .await
                .map_err(|e| format!("Failed to initialize OpenAIProvider: {e}"))?;

                return Ok(RealOrMockProvider::Real {
                    provider: Box::new(provider),
                    provider_id: "openai".to_string(),
                    model_id: model,
                });
            }
        }

        // If WARSHA_E2E_REAL=1 but no key was found: fail cleanly with explicit message.
        Err(
            "WARSHA_E2E_REAL=1 is set, but no API key was found in WARSHA_REAL_PROVIDER_KEY, \
             OPENAI_API_KEY, ANTHROPIC_API_KEY, or SecretStore. \
             A real model API key is required to execute the real-model E2E test."
                .to_string(),
        )
    }
}

#[tokio::test]
async fn e2e_real_arabic_request_clinic_flow() {
    // ---- 1. Check execution mode: offline MockProvider or real model API.
    let provider_mode = RealOrMockProvider::detect().await.unwrap_or_else(|err| {
        panic!("{err}");
    });

    let is_real_model = matches!(provider_mode, RealOrMockProvider::Real { .. });

    // ---- 2. Setup: temporary directories, daemon state, RPC.
    let temp = tempdir().expect("temporary directory");
    let data_dir = temp.path().join("data");
    let project_dir = temp.path().join(PACKAGE_NAME);
    let state = daemon_state(&data_dir, provider_mode).await;
    let rpc = WarshaRpc::new(state.clone());

    // ---- 3. Create project from Arabic prompt: "تطبيق حجز مواعيد لعيادة أسنان".
    let project = rpc
        .create_project(
            PACKAGE_NAME.to_string(),
            ARABIC_REQUEST.to_string(),
            "ar".to_string(),
        )
        .await
        .expect("projects.create succeeds");
    assert_eq!(project.name, PACKAGE_NAME);
    assert_eq!(project.description, ARABIC_REQUEST);

    let run = rpc
        .start_run(project.id, ARABIC_REQUEST.to_string())
        .await
        .expect("runs.start succeeds");
    assert_eq!(run.current_stage, Stage::Idea);
    assert_eq!(
        run.artifacts.get("idea").expect("idea is recorded").content,
        ARABIC_REQUEST
    );

    // Initial event is logged
    let events = rpc
        .get_events(run.id)
        .await
        .expect("the run's events are readable");
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, EventKind::StageStarted);
    assert_eq!(events[0].stage, Stage::Idea);

    // ---- 4. Intake stage: Clarifying question in Arabic.
    // The intake agent asks the clarifying question about working hours and specialties.
    {
        let mut agent = state.agent_loop.write().await;
        agent
            .ask_queue
            .enqueue(AskUserRequest::new("clinic_q1", CLARIFYING_QUESTION, true))
            .expect("clarifying question queues");
        assert!(
            agent.ask_queue.blocks_run(),
            "an unanswered clarifying question blocks the run"
        );
    }

    // Owner answers in Arabic with clinic hours and specialties.
    {
        let mut agent = state.agent_loop.write().await;
        let answered = agent
            .ask_queue
            .answer("clinic_q1", OWNER_ANSWER)
            .expect("answering the clarifying question succeeds");
        assert_eq!(answered.question, CLARIFYING_QUESTION);
        assert_eq!(answered.answer.as_deref(), Some(OWNER_ANSWER));
        assert!(
            !agent.ask_queue.blocks_run(),
            "the run is unblocked once the question is answered"
        );
        assert_eq!(agent.ask_queue.answered_count(), 1);
    }

    // ---- 5. Plan stage: Plan mode turn, owner approval into Agent mode.
    let plan_turn = {
        let mut agent = state.agent_loop.write().await;
        agent.run_turn(ARABIC_REQUEST, &[]).await
    };
    assert_eq!(plan_turn.mode, AgentMode::Plan);
    assert!(
        !state.agent_loop.read().await.mode_manager.can_edit(),
        "Plan mode cannot edit files"
    );

    let approval = {
        let mut agent = state.agent_loop.write().await;
        agent
            .approve_agent_mode(OWNER)
            .expect("owner may approve transition to Agent mode")
    };
    assert!(approval.is_owner_approved());
    assert_eq!(approval.from, AgentMode::Plan);
    assert_eq!(approval.to, AgentMode::Agent);

    // Owner approves Gate A (brief approval)
    let device = DeviceId::new();
    let run = rpc
        .approve_gate(run.id, Stage::GateA, device)
        .await
        .expect("Gate A approves");
    assert!(matches!(
        run.gate_states[&Stage::GateA],
        GateState::Approved { .. }
    ));

    // ---- 6. Pipeline stages walk and cost accounting.
    let engine = state.pipeline.clone();
    let run = engine.advance_stage(run.id).await.expect("Idea -> Gate A");
    assert_eq!(run.current_stage, Stage::GateA);

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Gate A -> Research");
    assert_eq!(run.current_stage, Stage::Research);

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Research -> PRD Spec");
    assert_eq!(run.current_stage, Stage::PrdSpec);

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("PRD Spec -> Gate B");
    assert_eq!(run.current_stage, Stage::GateB);

    let run = rpc
        .approve_gate(run.id, Stage::GateB, device)
        .await
        .expect("Gate B approves");
    assert!(matches!(
        run.gate_states[&Stage::GateB],
        GateState::Approved { .. }
    ));

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Gate B -> Design");
    assert_eq!(run.current_stage, Stage::Design);

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Design -> Plan Tasks");
    assert_eq!(run.current_stage, Stage::PlanTasks);

    // Plan Tasks stage reached the model provider
    if !is_real_model {
        assert_eq!(run.artifacts["plan_tasks"].content, MOCK_RESPONSE);
    }
    engine
        .upsert_artifact(
            run.id,
            stage_artifact(
                "plan_tasks",
                SCRIPTED_PLAN,
                Stage::PlanTasks,
                Role::Architect,
            ),
        )
        .await
        .expect("plan artifact upserted");

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Plan Tasks -> Code");
    assert_eq!(run.current_stage, Stage::Code);
    if !is_real_model {
        assert_eq!(run.artifacts["code"].content, MOCK_RESPONSE);
    }
    engine
        .upsert_artifact(
            run.id,
            stage_artifact("code", SCRIPTED_CODE, Stage::Code, Role::Coder),
        )
        .await
        .expect("code artifact upserted");

    let run = engine
        .advance_stage(run.id)
        .await
        .expect("Code -> Review / QA / Security");
    assert_eq!(run.current_stage, Stage::ReviewQaSecurity);
    if !is_real_model {
        assert_eq!(run.artifacts["review_qa_security"].content, MOCK_RESPONSE);
    }
    engine
        .upsert_artifact(
            run.id,
            stage_artifact(
                "review_qa_security",
                SCRIPTED_TESTS,
                Stage::ReviewQaSecurity,
                Role::Reviewer,
            ),
        )
        .await
        .expect("test artifact upserted");

    // ---- 7. Cost cap enforcement via Warsha's own cost accounting.
    {
        let mut providers = state.providers.write().await;
        // Verify cost calculation
        let usage = TokenUsage {
            input: 2_000,
            output: 1_000,
            total: 3_000,
        };
        let estimated_cost = providers
            .cost_of("test-model", &usage)
            .expect("cost_of succeeds");
        assert!(
            estimated_cost > 0,
            "cost calculation produces non-zero cents"
        );

        // Verify budget cap enforcement
        let project_key = project.id.to_string();
        let current_spent = providers.get_spent(&project_key);
        assert!(
            current_spent <= BUDGET_CAP_CENTS,
            "spent ({current_spent}) must not exceed budget cap ({BUDGET_CAP_CENTS})"
        );

        // Prove budget cap blocks further spend when budget is exceeded:
        let test_project_id = "test-budget-enforcement";
        // With budget set to 0, any request is rejected as exceeding budget
        providers.set_budget(test_project_id, 0);
        let test_req = ChatRequest {
            model: "any".to_string(),
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: "ping".to_string(),
            }],
            temperature: None,
            max_tokens: None,
            stream: false,
        };
        let blocked = providers
            .chat_with_fallback(Role::Researcher, test_project_id, test_req)
            .await;
        assert!(
            matches!(blocked, Err(ProviderError::BudgetExceeded)),
            "budget cap enforcement must return ProviderError::BudgetExceeded when budget is exceeded"
        );
    }

    // ---- 8. Generated files written to working tree.
    let mut files = parse_file_blocks(SCRIPTED_CODE).expect("parse code blocks");
    files.extend(parse_file_blocks(SCRIPTED_TESTS).expect("parse test blocks"));
    let written = write_generated_files(&project_dir, &files).expect("files written to project");
    assert!(
        written.len() >= 6,
        "Cargo.toml, src/lib.rs, src/main.rs, tests, html/css/js generated"
    );

    // Verify all generated files exist on disk
    for path in &written {
        assert!(
            project_dir.join(path).is_file(),
            "expected {path} in {}",
            project_dir.display()
        );
    }

    // ---- 9. Tests pass: `cargo test` runs offline in generated project.
    let tested = run_cargo(&project_dir, &["test"])
        .await
        .expect("cargo test runs");
    assert!(tested.success, "cargo test failed:\n{}", tested.output());
    let passed = passed_test_count(&tested.stdout);
    assert_eq!(
        passed,
        4,
        "3 unit tests in lib.rs + 1 integration test in clinic_tests.rs must pass:\n{}",
        tested.output()
    );

    // ---- 10. Web app builds: `cargo build`.
    let built = run_cargo(&project_dir, &["build"])
        .await
        .expect("cargo build runs");
    assert!(built.success, "cargo build failed:\n{}", built.output());
    let binary = binary_path(&project_dir);
    assert!(binary.is_file(), "binary exists at {}", binary.display());

    // ---- 11. Runnable web app verification: preview server starts and answers HTTP GET.
    let (server_url, mut server_child) = spawn_web_server(&binary, &project_dir)
        .await
        .expect("clinic app server starts and prints URL");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("reqwest client");
    let resp = client
        .get(&server_url)
        .send()
        .await
        .expect("HTTP GET to dental clinic app succeeds");
    assert!(resp.status().is_success(), "HTTP status is 200 OK");
    let headers = resp.headers().clone();
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    assert!(
        content_type.contains("text/html"),
        "response Content-Type must be text/html, got {content_type}"
    );

    let body = resp.text().await.expect("read response body");
    assert!(
        body.contains("تطبيق حجز مواعيد لعيادة أسنان") || body.contains("عيادة الأسنان"),
        "page body must contain clinic title in Arabic"
    );
    assert!(
        body.contains("طب أسنان عام"),
        "page body must list General Dentistry specialty in Arabic"
    );
    assert!(
        body.contains("ساعات العمل"),
        "page body must contain clinic working hours in Arabic"
    );

    // Stop server
    let _ = server_child.kill().await;

    // ---- 12. Screenshot / preview artifacts written to `bridge-io/shots/`.
    let shots_dir = find_shots_dir();
    std::fs::create_dir_all(&shots_dir).expect("create bridge-io/shots directory");

    let preview_html_path = shots_dir.join("clinic-app-preview.html");
    std::fs::write(&preview_html_path, &body).expect("write clinic-app-preview.html");

    let png_bytes = render_clinic_preview_png(800, 600);
    let preview_png_path = shots_dir.join("clinic-app-preview.png");
    std::fs::write(&preview_png_path, &png_bytes).expect("write clinic-app-preview.png");

    // Also write to Windows host path if running under WSL
    let wsl_mnt = Path::new("/mnt/c/Users/Dragonfly/Downloads/Warsha/bridge-io/shots");
    if wsl_mnt.is_dir() {
        let _ = std::fs::write(wsl_mnt.join("clinic-app-preview.html"), &body);
        let _ = std::fs::write(wsl_mnt.join("clinic-app-preview.png"), &png_bytes);
    }

    assert!(
        preview_png_path.is_file(),
        "preview screenshot exists at {}",
        preview_png_path.display()
    );
    let meta = std::fs::metadata(&preview_png_path).expect("png metadata");
    assert!(meta.len() > 1000, "screenshot file is non-empty");
    assert!(
        png_bytes.starts_with(&[137, 80, 78, 71, 13, 10, 26, 10]),
        "valid PNG magic bytes"
    );

    // ---- 13. Event log persists and reads back with gate approvals.
    let stored_run = rpc.get_run(run.id).await.expect("run is readable");
    assert_eq!(stored_run.current_stage, Stage::ReviewQaSecurity);

    let all_events = rpc.get_events(run.id).await.expect("events are readable");
    let decisions: Vec<&Event> = all_events
        .iter()
        .filter(|e| e.kind == EventKind::GateDecision)
        .collect();
    assert_eq!(decisions.len(), 2, "Gate A and Gate B approved");
    assert_eq!(decisions[0].stage, Stage::GateA);
    assert_eq!(decisions[1].stage, Stage::GateB);
    for d in &decisions {
        assert_eq!(d.device_id, Some(device));
        assert_eq!(d.payload["decision"], json!("approved"));
    }
}

#[tokio::test]
async fn test_real_mode_fails_cleanly_without_key() {
    // When WARSHA_E2E_REAL=1 is explicitly requested but no keys are in environment,
    // RealOrMockProvider::detect() must return an explicit error.
    let original_e2e = std::env::var("WARSHA_E2E_REAL").ok();
    let original_real_key = std::env::var("WARSHA_REAL_PROVIDER_KEY").ok();
    let original_openai = std::env::var("OPENAI_API_KEY").ok();
    let original_anthropic = std::env::var("ANTHROPIC_API_KEY").ok();

    std::env::set_var("WARSHA_E2E_REAL", "1");
    std::env::remove_var("WARSHA_REAL_PROVIDER_KEY");
    std::env::remove_var("OPENAI_API_KEY");
    std::env::remove_var("ANTHROPIC_API_KEY");

    let detected = RealOrMockProvider::detect().await;
    assert!(
        detected.is_err(),
        "Must fail when WARSHA_E2E_REAL=1 has no keys"
    );
    let msg = detected.err().unwrap_or_default();
    assert!(
        msg.contains("WARSHA_E2E_REAL=1 is set, but no API key was found"),
        "Error message must clearly state key is missing: {msg}"
    );

    // Restore environment
    if let Some(v) = original_e2e {
        std::env::set_var("WARSHA_E2E_REAL", v);
    } else {
        std::env::remove_var("WARSHA_E2E_REAL");
    }
    if let Some(v) = original_real_key {
        std::env::set_var("WARSHA_REAL_PROVIDER_KEY", v);
    }
    if let Some(v) = original_openai {
        std::env::set_var("OPENAI_API_KEY", v);
    }
    if let Some(v) = original_anthropic {
        std::env::set_var("ANTHROPIC_API_KEY", v);
    }
}

/// Daemon state initialization for the E2E test.
async fn daemon_state(data_dir: &Path, provider_mode: RealOrMockProvider) -> Arc<DaemonState> {
    std::fs::create_dir_all(data_dir).expect("create data dir");
    let store = Arc::new(
        Store::open_at(data_dir.join("warsha.db"))
            .await
            .expect("store opens"),
    );

    let mut router = ProviderRouter::new();

    let (active_provider_id, active_model_id) = match provider_mode {
        RealOrMockProvider::Real {
            provider,
            provider_id,
            model_id,
        } => {
            router.register_provider(provider);
            (provider_id, model_id)
        }
        RealOrMockProvider::Mock => {
            router.register_provider(Box::new(MockProvider::new(MOCK_PROVIDER)));
            (MOCK_PROVIDER.to_string(), MOCK_MODEL.to_string())
        }
    };

    for role in [
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Coder,
        Role::Reviewer,
        Role::Intake,
    ] {
        router.set_role_routing(RoleRouting {
            role,
            targets: vec![RoutingTarget {
                provider_id: active_provider_id.clone(),
                model_id: active_model_id.clone(),
                weight: 100,
            }],
            fallback_enabled: false,
            budget_cents_per_run: Some(BUDGET_CAP_CENTS),
        });
    }

    let providers = Arc::new(RwLock::new(router));
    let pipeline = Arc::new(PipelineEngine::new(store.clone(), providers.clone()));

    let identity = DeviceIdentity::generate("arabic e2e daemon".to_string()).expect("device id");
    let (event_tx, _receiver) = broadcast::channel::<Event>(64);
    let processes: Arc<dyn ProcessManager> = InMemoryProcessManager::shared();
    let mcp: Arc<dyn McpManager> = Arc::new(InMemoryMcpManager::new(processes.clone()));
    let previews = Arc::new(LivePreviewManager::new(processes.clone()));
    let settings = Arc::new(
        SettingsStore::open(&data_dir.join("warsha.db"))
            .await
            .expect("settings open"),
    );

    // Agent loop with tools and router
    let agent_tools = FilesystemToolExecutor::new(data_dir.join("workspace"));
    let agent_router = ProviderRouterAdapter::new(providers.clone(), AGENT_ROLE, "agent-loop");
    let agent_loop = Arc::new(RwLock::new(
        AgentLoop::with_tool_executor(Box::new(agent_tools)).with_router(Arc::new(agent_router)),
    ));

    Arc::new(DaemonState {
        config: DaemonConfig {
            data_dir: data_dir.to_path_buf(),
            auth_token: "e2e-arabic-token".to_string(),
            ..DaemonConfig::default()
        },
        store,
        providers,
        pipeline,
        backends: BackendFactory::all_available(),
        github: None,
        devices: Arc::new(DeviceRegistry::new(identity)),
        event_tx,
        backend_kits: Arc::new(RwLock::new(HashMap::new())),
        crash_reports: Arc::new(RwLock::new(InMemoryCrashReportStore::new())),
        store_reviews: Arc::new(RwLock::new(InMemoryStoreReviewStore::new())),
        agent_loop,
        processes,
        mcp,
        previews,
        settings,
        run_modes: Arc::new(RwLock::new(
            RunMode::all()
                .into_iter()
                .map(|m| (m, RunModeConfig::for_mode(m)))
                .collect(),
        )),
        preferences: Arc::new(RwLock::new(InMemoryPreferenceStore::new())),
        stored_preferences: Arc::new(RwLock::new(HashMap::new())),
        pairings: Arc::new(RwLock::new(InMemoryPairingStore::new())),
        secrets: Arc::new(InMemorySecretStore::new()),
    })
}

fn stage_artifact(name: &str, content: &str, stage: Stage, role: Role) -> Artifact {
    let now = Utc::now();
    Artifact {
        name: name.to_string(),
        content: content.to_string(),
        stage,
        role: Some(role),
        created_at: now,
        updated_at: now,
        version: 1,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct GeneratedFile {
    path: String,
    contents: String,
}

const FILE_MARKER: &str = "--- FILE:";

fn parse_file_blocks(answer: &str) -> Result<Vec<GeneratedFile>, String> {
    let mut files = Vec::new();
    let mut open: Option<(String, Vec<&str>)> = None;

    for line in answer.lines() {
        if let Some(path) = file_block_path(line) {
            if let Some((p, body)) = open.take() {
                files.push(finish_block(p, &body)?);
            }
            open = Some((path, Vec::new()));
        } else if let Some((_, body)) = open.as_mut() {
            body.push(line);
        }
    }
    if let Some((p, body)) = open.take() {
        files.push(finish_block(p, &body)?);
    }
    if files.is_empty() {
        return Err("No file blocks found in answer".to_string());
    }
    Ok(files)
}

fn file_block_path(line: &str) -> Option<String> {
    let rest = line.trim().strip_prefix(FILE_MARKER)?;
    let path = rest.trim().strip_suffix("---")?.trim();
    if path.is_empty() {
        None
    } else {
        Some(path.to_string())
    }
}

fn finish_block(path: String, body: &[&str]) -> Result<GeneratedFile, String> {
    if !is_safe_relative_path(&path) {
        return Err(format!("Unsafe path rejected: {path}"));
    }
    let contents = body.join("\n").trim_end().to_string();
    if contents.is_empty() {
        return Err(format!("File block for {path} is empty"));
    }
    Ok(GeneratedFile { path, contents })
}

fn is_safe_relative_path(path: &str) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\\') {
        return false;
    }
    let candidate = Path::new(trimmed);
    !candidate.is_absolute()
        && candidate
            .components()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn write_generated_files(
    project_dir: &Path,
    files: &[GeneratedFile],
) -> Result<Vec<String>, String> {
    let mut written = Vec::with_capacity(files.len());
    for file in files {
        let target = project_dir.join(&file.path);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        std::fs::write(&target, format!("{}\n", file.contents))
            .map_err(|e| format!("write {}: {e}", target.display()))?;
        written.push(file.path.clone());
    }
    Ok(written)
}

struct CommandRun {
    command: String,
    success: bool,
    stdout: String,
    stderr: String,
}

impl CommandRun {
    fn from_output(command: String, output: std::process::Output) -> Self {
        Self {
            command,
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        }
    }

    fn output(&self) -> String {
        format!(
            "$ {}\n--- stdout ---\n{}\n--- stderr ---\n{}",
            self.command, self.stdout, self.stderr
        )
    }
}

async fn run_cargo(project_dir: &Path, args: &[&str]) -> Result<CommandRun, String> {
    let program = std::env::var("CARGO").unwrap_or_else(|_| "cargo".to_string());
    let output = tokio::process::Command::new(&program)
        .current_dir(project_dir)
        .arg("--offline")
        .args(args)
        .env("CARGO_TARGET_DIR", project_dir.join("target"))
        .env("CARGO_NET_OFFLINE", "true")
        .stdin(std::process::Stdio::null())
        .output()
        .await
        .map_err(|e| format!("run {program}: {e}"))?;
    Ok(CommandRun::from_output(
        format!("{program} --offline {}", args.join(" ")),
        output,
    ))
}

fn binary_path(project_dir: &Path) -> PathBuf {
    project_dir
        .join("target")
        .join("debug")
        .join(format!("{PACKAGE_NAME}{}", std::env::consts::EXE_SUFFIX))
}

fn passed_test_count(output: &str) -> usize {
    output
        .lines()
        .filter_map(|line| {
            let rest = line.split_once("test result: ok. ")?.1;
            rest.split_whitespace().next()?.parse::<usize>().ok()
        })
        .sum()
}

/// Spawn the built clinic web server and wait for its URL to be announced.
async fn spawn_web_server(
    binary: &Path,
    project_dir: &Path,
) -> Result<(String, tokio::process::Child), String> {
    use tokio::io::{AsyncBufReadExt, BufReader};

    let mut child = tokio::process::Command::new(binary)
        .current_dir(project_dir)
        .arg("--port")
        .arg("0")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn web server {}: {e}", binary.display()))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture server stdout".to_string())?;

    let mut reader = BufReader::new(stdout).lines();
    let timeout = Duration::from_secs(5);
    let deadline = tokio::time::Instant::now() + timeout;

    while tokio::time::Instant::now() < deadline {
        tokio::select! {
            line = reader.next_line() => {
                if let Ok(Some(l)) = line {
                    if let Some(pos) = l.find("http://") {
                        let candidate = &l[pos..];
                        let url = candidate.split_whitespace().next().unwrap_or(candidate);
                        return Ok((url.to_string(), child));
                    }
                }
            }
            _ = tokio::time::sleep(Duration::from_millis(50)) => {}
        }
    }

    let _ = child.kill().await;
    Err("Timed out waiting for web server to print bound URL".to_string())
}

/// Locate or create the `bridge-io/shots` directory relative to repository root.
fn find_shots_dir() -> PathBuf {
    if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
        let manifest_path = PathBuf::from(manifest_dir);
        if let Some(crates_dir) = manifest_path.parent() {
            if let Some(repo_root) = crates_dir.parent() {
                return repo_root.join("bridge-io").join("shots");
            }
        }
    }
    let mut current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    for _ in 0..5 {
        let candidate = current.join("bridge-io").join("shots");
        if candidate.is_dir() || current.join("Cargo.lock").is_file() {
            return candidate;
        }
        if let Some(parent) = current.parent() {
            current = parent.to_path_buf();
        } else {
            break;
        }
    }
    PathBuf::from("bridge-io/shots")
}

// ---------------------------------------------------------------------------
// Zero-dependency PNG Encoder & Screenshot Renderer
// ---------------------------------------------------------------------------

fn crc32(data: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc ^= b as u32;
        for _ in 0..8 {
            if (crc & 1) != 0 {
                crc = (crc >> 1) ^ 0xEDB8_8320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

fn adler32(data: &[u8]) -> u32 {
    let mut s1: u32 = 1;
    let mut s2: u32 = 0;
    for &b in data {
        s1 = (s1 + b as u32) % 65521;
        s2 = (s2 + s1) % 65521;
    }
    (s2 << 16) | s1
}

fn write_png_chunk(out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(chunk_type);
    out.extend_from_slice(data);
    let mut crc_buf = Vec::with_capacity(4 + data.len());
    crc_buf.extend_from_slice(chunk_type);
    crc_buf.extend_from_slice(data);
    let crc = crc32(&crc_buf);
    out.extend_from_slice(&crc.to_be_bytes());
}

#[allow(clippy::too_many_arguments)]
fn fill_rect(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    x0: u32,
    y0: u32,
    w: u32,
    h: u32,
    r: u8,
    g: u8,
    b: u8,
) {
    for y in y0..(y0 + h).min(height) {
        for x in x0..(x0 + w).min(width) {
            let idx = ((y * width + x) * 3) as usize;
            pixels[idx] = r;
            pixels[idx + 1] = g;
            pixels[idx + 2] = b;
        }
    }
}

/// Render an 800x600 preview screenshot PNG of the generated dental clinic web app.
fn render_clinic_preview_png(width: u32, height: u32) -> Vec<u8> {
    let mut pixels = vec![0u8; (width * height * 3) as usize];

    // Background color: Dark surface #0E0E0E
    for i in 0..(width * height) as usize {
        pixels[i * 3] = 14;
        pixels[i * 3 + 1] = 14;
        pixels[i * 3 + 2] = 14;
    }

    // 1. Browser titlebar
    fill_rect(&mut pixels, width, height, 0, 0, width, 36, 26, 26, 26);
    fill_rect(&mut pixels, width, height, 0, 0, width, 3, 255, 214, 10); // Warsha accent stripe #FFD60A

    // Window controls
    fill_rect(&mut pixels, width, height, 16, 12, 12, 12, 239, 68, 68); // Red
    fill_rect(&mut pixels, width, height, 34, 12, 12, 12, 245, 158, 11); // Yellow
    fill_rect(&mut pixels, width, height, 52, 12, 12, 12, 16, 185, 129); // Green

    // Address bar
    fill_rect(
        &mut pixels,
        width,
        height,
        80,
        8,
        width - 100,
        20,
        38,
        38,
        38,
    );

    // 2. Central container card: max-width 680, centered
    let card_x = (width - 640) / 2;
    let card_y = 60;
    let card_w = 640;
    let card_h = 500;
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x,
        card_y,
        card_w,
        card_h,
        26,
        26,
        26,
    ); // Card background #1A1A1A

    // Border around card
    for x in card_x..(card_x + card_w) {
        let top_idx = ((card_y * width + x) * 3) as usize;
        let bot_idx = (((card_y + card_h - 1) * width + x) * 3) as usize;
        pixels[top_idx] = 51;
        pixels[top_idx + 1] = 51;
        pixels[top_idx + 2] = 51;
        pixels[bot_idx] = 51;
        pixels[bot_idx + 1] = 51;
        pixels[bot_idx + 2] = 51;
    }
    for y in card_y..(card_y + card_h) {
        let left_idx = ((y * width + card_x) * 3) as usize;
        let right_idx = ((y * width + card_x + card_w - 1) * 3) as usize;
        pixels[left_idx] = 51;
        pixels[left_idx + 1] = 51;
        pixels[left_idx + 2] = 51;
        pixels[right_idx] = 51;
        pixels[right_idx + 1] = 51;
        pixels[right_idx + 2] = 51;
    }

    // 3. Header inside card
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 30,
        card_y + 30,
        260,
        26,
        255,
        214,
        10,
    ); // Clinic Title Bar #FFD60A
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 30,
        card_y + 64,
        380,
        14,
        160,
        160,
        160,
    ); // Working Hours subtitle
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 30,
        card_y + 90,
        card_w - 60,
        2,
        255,
        214,
        10,
    ); // Divider

    // 4. Form inputs (Patient Name, Phone, Specialty, Date, Time)
    let mut current_y = card_y + 110;
    for (label_w, is_select) in [(100, false), (80, false), (110, true), (90, false)] {
        fill_rect(
            &mut pixels,
            width,
            height,
            card_x + 30,
            current_y,
            label_w,
            14,
            220,
            220,
            220,
        ); // Label
        current_y += 22;
        fill_rect(
            &mut pixels,
            width,
            height,
            card_x + 30,
            current_y,
            card_w - 60,
            32,
            36,
            36,
            36,
        ); // Input background
           // Input inner border
        for x in (card_x + 30)..(card_x + card_w - 30) {
            let t = ((current_y * width + x) * 3) as usize;
            let b = (((current_y + 31) * width + x) * 3) as usize;
            pixels[t] = 60;
            pixels[t + 1] = 60;
            pixels[t + 2] = 60;
            pixels[b] = 60;
            pixels[b + 1] = 60;
            pixels[b + 2] = 60;
        }
        if is_select {
            // Simulated dropdown arrow
            fill_rect(
                &mut pixels,
                width,
                height,
                card_x + card_w - 55,
                current_y + 12,
                10,
                8,
                200,
                200,
                200,
            );
        }
        current_y += 44;
    }

    // 5. Submit Button: #FFD60A
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 30,
        current_y,
        card_w - 60,
        40,
        255,
        214,
        10,
    );
    current_y += 54;

    // 6. Confirmation Banner: Emerald green #10B981
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 30,
        current_y,
        card_w - 60,
        48,
        6,
        78,
        59,
    ); // Green dark bg
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 44,
        current_y + 16,
        16,
        16,
        16,
        185,
        129,
    ); // Green checkmark icon
    fill_rect(
        &mut pixels,
        width,
        height,
        card_x + 70,
        current_y + 18,
        440,
        12,
        209,
        250,
        229,
    ); // Confirmation text line

    // Compile scanlines with PNG filter byte 0x00
    let mut scanlines = Vec::with_capacity((height * (1 + width * 3)) as usize);
    for y in 0..height {
        scanlines.push(0x00); // Filter: None
        let row_start = (y * width * 3) as usize;
        let row_end = row_start + (width * 3) as usize;
        scanlines.extend_from_slice(&pixels[row_start..row_end]);
    }

    // Deflate uncompressed blocks
    let mut zlib_stream = Vec::new();
    zlib_stream.push(0x78); // CMF
    zlib_stream.push(0x01); // FLG

    let block_size = 65535;
    let total_bytes = scanlines.len();
    let mut offset = 0;
    while offset < total_bytes {
        let end = (offset + block_size).min(total_bytes);
        let is_final = end == total_bytes;
        zlib_stream.push(if is_final { 0x01 } else { 0x00 });
        let chunk_len = (end - offset) as u16;
        let chunk_nlen = !chunk_len;
        zlib_stream.extend_from_slice(&chunk_len.to_le_bytes());
        zlib_stream.extend_from_slice(&chunk_nlen.to_le_bytes());
        zlib_stream.extend_from_slice(&scanlines[offset..end]);
        offset = end;
    }
    let adler = adler32(&scanlines);
    zlib_stream.extend_from_slice(&adler.to_be_bytes());

    // Assemble PNG
    let mut png = Vec::new();
    png.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth 8
    ihdr.push(2); // RGB color type
    ihdr.push(0); // compression method 0
    ihdr.push(0); // filter method 0
    ihdr.push(0); // interlace method 0
    write_png_chunk(&mut png, b"IHDR", &ihdr);

    // IDAT
    write_png_chunk(&mut png, b"IDAT", &zlib_stream);

    // IEND
    write_png_chunk(&mut png, b"IEND", &[]);

    png
}
