//! Gate integrity invariants and artifact-bound decision digests (K1).
//!
//! Every gate decision (`approve`, `reject`, `request_changes`) is allowed only when the
//! run is [`RunStatus::Running`], the run's `current_stage` is that exact gate, and the
//! gate's state is still [`GateState::Pending`]. Each recorded decision event carries
//! `artifacts_sha256`, a deterministic SHA-256 digest of the run's artifacts at the
//! moment of the decision.

use std::collections::HashMap;
use warsha_core::{Artifact, GateState, Run, RunStatus, Stage};

use crate::{stage_to_string, PipelineError, Result};

/// Validate that `run` can currently accept a gate decision for `stage`.
pub(crate) fn ensure_gate_decidable(run: &Run, stage: Stage) -> Result<()> {
    if !stage.is_gate() {
        return Err(PipelineError::Other(format!(
            "{:?} is not a gate stage",
            stage
        )));
    }

    if run.status != RunStatus::Running {
        return Err(PipelineError::Other(format!(
            "Run is not running: {:?}",
            run.status
        )));
    }

    if run.current_stage != stage {
        return Err(PipelineError::Other(format!(
            "Gate {:?} is not current stage {:?}",
            stage, run.current_stage
        )));
    }

    let gate_state = run
        .gate_states
        .get(&stage)
        .ok_or_else(|| PipelineError::Other("Gate not found".to_string()))?;
    if !matches!(gate_state, GateState::Pending) {
        return Err(PipelineError::GateNotPending(stage));
    }

    Ok(())
}

/// Compute a deterministic SHA-256 hex digest over all artifacts on a run.
///
/// Entries are sorted by artifact name and domain-separated by explicit byte lengths so
/// the resulting 64-character lowercase hex string depends solely on the artifact set
/// (`name`, `stage`, `version`, `content`), independent of `HashMap` iteration order.
pub fn artifacts_sha256(artifacts: &HashMap<String, Artifact>) -> String {
    let mut entries: Vec<(&String, &Artifact)> = artifacts.iter().collect();
    entries.sort_by(|(a, _), (b, _)| a.cmp(b));

    let mut hasher = Sha256::new();
    hasher.update(&(entries.len() as u64).to_le_bytes());
    for (name, artifact) in entries {
        update_len_prefixed(&mut hasher, name.as_bytes());
        update_len_prefixed(&mut hasher, stage_to_string(artifact.stage).as_bytes());
        hasher.update(&artifact.version.to_le_bytes());
        update_len_prefixed(&mut hasher, artifact.content.as_bytes());
    }
    hasher.finalize_hex()
}

fn update_len_prefixed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update(&(bytes.len() as u64).to_le_bytes());
    hasher.update(bytes);
}

/// Pure-Rust FIPS 180-4 SHA-256 implementation (no external digest dependency).
struct Sha256 {
    state: [u32; 8],
    bit_len: u64,
    buffer: [u8; 64],
    buffer_len: usize,
}

impl Sha256 {
    const K: [u32; 64] = [
        0x428a_2f98,
        0x7137_4491,
        0xb5c0_fbcf,
        0xe9b5_dba5,
        0x3956_c25b,
        0x59f1_11f1,
        0x923f_82a4,
        0xab1c_5ed5,
        0xd807_aa98,
        0x1283_5b01,
        0x2431_85be,
        0x550c_7dc3,
        0x72be_5d74,
        0x80de_b1fe,
        0x9bdc_06a7,
        0xc19b_f174,
        0xe49b_69c1,
        0xefbe_4786,
        0x0fc1_9dc6,
        0x240c_a1cc,
        0x2de9_2c6f,
        0x4a74_84aa,
        0x5cb0_a9dc,
        0x76f9_88da,
        0x983e_5152,
        0xa831_c66d,
        0xb003_27c8,
        0xbf59_7fc7,
        0xc6e0_0bf3,
        0xd5a7_9147,
        0x06ca_6351,
        0x1429_2967,
        0x27b7_0a85,
        0x2e1b_2138,
        0x4d2c_6dfc,
        0x5338_0d13,
        0x650a_7354,
        0x766a_0abb,
        0x81c2_c92e,
        0x9272_2c85,
        0xa2bf_e8a1,
        0xa81a_664b,
        0xc24b_8b70,
        0xc76c_51a3,
        0xd192_e819,
        0xd699_0624,
        0xf40e_3585,
        0x106a_a070,
        0x19a4_c116,
        0x1e37_6c08,
        0x2748_774c,
        0x34b0_bcb5,
        0x391c_0cb3,
        0x4ed8_aa4a,
        0x5b9c_ca4f,
        0x682e_6ff3,
        0x748f_82ee,
        0x78a5_636f,
        0x84c8_7814,
        0x8cc7_0208,
        0x90be_fffa,
        0xa450_6ceb,
        0xbef9_a3f7,
        0xc671_78f2,
    ];

    fn new() -> Self {
        Self {
            state: [
                0x6a09_e667,
                0xbb67_ae85,
                0x3c6e_f372,
                0xa54f_f53a,
                0x510e_527f,
                0x9b05_688c,
                0x1f83_d9ab,
                0x5be0_cd19,
            ],
            bit_len: 0,
            buffer: [0; 64],
            buffer_len: 0,
        }
    }

    fn update(&mut self, data: &[u8]) {
        self.bit_len = self.bit_len.wrapping_add((data.len() as u64) * 8);
        let mut offset = 0;

        if self.buffer_len > 0 {
            let needed = 64 - self.buffer_len;
            let take = needed.min(data.len());
            self.buffer[self.buffer_len..self.buffer_len + take].copy_from_slice(&data[..take]);
            self.buffer_len += take;
            offset += take;
            if self.buffer_len == 64 {
                let block = self.buffer;
                self.compress(&block);
                self.buffer_len = 0;
            }
        }

        while offset + 64 <= data.len() {
            let mut block = [0u8; 64];
            block.copy_from_slice(&data[offset..offset + 64]);
            self.compress(&block);
            offset += 64;
        }

        if offset < data.len() {
            let rem = data.len() - offset;
            self.buffer[..rem].copy_from_slice(&data[offset..]);
            self.buffer_len = rem;
        }
    }

    fn finalize_hex(mut self) -> String {
        let total_bits = self.bit_len;
        self.buffer[self.buffer_len] = 0x80;
        self.buffer_len += 1;

        if self.buffer_len > 56 {
            self.buffer[self.buffer_len..64].fill(0);
            let block = self.buffer;
            self.compress(&block);
            self.buffer_len = 0;
        }

        self.buffer[self.buffer_len..56].fill(0);
        self.buffer[56..64].copy_from_slice(&total_bits.to_be_bytes());
        let block = self.buffer;
        self.compress(&block);

        let mut out = String::with_capacity(64);
        for word in self.state {
            use std::fmt::Write as _;
            let _ = write!(out, "{word:08x}");
        }
        out
    }

    fn compress(&mut self, block: &[u8; 64]) {
        let mut w = [0u32; 64];
        for (i, chunk) in block.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }

        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = self.state;
        for i in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = h
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(Self::K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);

            h = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }

        self.state[0] = self.state[0].wrapping_add(a);
        self.state[1] = self.state[1].wrapping_add(b);
        self.state[2] = self.state[2].wrapping_add(c);
        self.state[3] = self.state[3].wrapping_add(d);
        self.state[4] = self.state[4].wrapping_add(e);
        self.state[5] = self.state[5].wrapping_add(f);
        self.state[6] = self.state[6].wrapping_add(g);
        self.state[7] = self.state[7].wrapping_add(h);
    }
}

#[cfg(test)]
async fn test_engine() -> (
    std::sync::Arc<warsha_store::Store>,
    crate::PipelineEngine<crate::settings::SettingsStore>,
    warsha_core::ProjectId,
) {
    use chrono::Utc;
    use std::sync::Arc;
    use tokio::sync::RwLock;
    use warsha_core::{Project, ProjectId};
    use warsha_providers::ProviderRouter;
    use warsha_store::Store;

    let dir = crate::test_util::fresh_tempdir();
    let path = dir.path().join("gate_integrity.db");
    let store = Arc::new(Store::open_at(path).await.expect("store opens"));
    std::mem::forget(dir);

    let project = Project {
        id: ProjectId::new(),
        name: "Gate Integrity Test".to_string(),
        description: "Verify K1 gate invariants".to_string(),
        language: "en".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        repo_path: None,
        repo_url: None,
    };
    store
        .create_project(&project)
        .await
        .expect("project is stored");

    let providers = Arc::new(RwLock::new(ProviderRouter::new()));
    let settings = Arc::new(crate::settings::SettingsStore::new());
    let engine = crate::PipelineEngine::new(store.clone(), providers, settings);
    (store, engine, project.id)
}

#[cfg(test)]
#[tokio::test]
async fn approving_a_gate_the_run_has_not_reached_is_refused() {
    use warsha_core::{DeviceId, EventKind, GateState, Stage};

    let (store, engine, project_id) = test_engine().await;
    let run = engine
        .start_run(project_id, "Build an invoice app")
        .await
        .expect("run starts");
    assert_eq!(run.current_stage, Stage::Idea);

    // At Idea, even the first gate (GateA) and future gates (GateB, GateD) are unreached.
    for future_gate in [Stage::GateA, Stage::GateB, Stage::GateD] {
        let err = engine
            .approve_gate(run.id, future_gate, DeviceId::new())
            .await
            .expect_err("unreached gate approval must be refused");
        assert!(
            err.to_string().contains("not current stage"),
            "unexpected error for {future_gate:?}: {err}"
        );
    }

    // Advance into GateA: GateA is now current, while GateD is still unreached.
    let at_gate_a = engine
        .advance_stage(run.id)
        .await
        .expect("advance Idea -> GateA");
    assert_eq!(at_gate_a.current_stage, Stage::GateA);

    let approve_err = engine
        .approve_gate(run.id, Stage::GateD, DeviceId::new())
        .await
        .expect_err("future gate D cannot be approved at gate A");
    assert!(approve_err.to_string().contains("not current stage"));

    let reject_err = engine
        .reject_gate(
            run.id,
            Stage::GateD,
            "too early".to_string(),
            DeviceId::new(),
        )
        .await
        .expect_err("future gate D cannot be rejected at gate A");
    assert!(reject_err.to_string().contains("not current stage"));

    let changes_err = engine
        .request_changes(
            run.id,
            Stage::GateD,
            "too early".to_string(),
            DeviceId::new(),
        )
        .await
        .expect_err("future gate D cannot request changes at gate A");
    assert!(changes_err.to_string().contains("not current stage"));

    // All gates remain Pending and zero GateDecision events were recorded.
    let reloaded = store.get_run(run.id).await.expect("run reloads");
    for gate in [Stage::GateA, Stage::GateB, Stage::GateC, Stage::GateD] {
        assert_eq!(reloaded.gate_states[&gate], GateState::Pending);
    }
    let events = store.get_events(run.id).await.expect("events reload");
    assert!(
        events.iter().all(|e| e.kind != EventKind::GateDecision),
        "refused decisions must not emit GateDecision events"
    );
}

#[cfg(test)]
#[tokio::test]
async fn approving_the_current_gate_succeeds_once() {
    use warsha_core::{DeviceId, EventKind, GateState, Stage};

    let (store, engine, project_id) = test_engine().await;
    let run = engine
        .start_run(project_id, "Build a task board")
        .await
        .expect("run starts");
    let at_gate_a = engine
        .advance_stage(run.id)
        .await
        .expect("advance Idea -> GateA");
    assert_eq!(at_gate_a.current_stage, Stage::GateA);

    let first_device = DeviceId::new();
    let approved = engine
        .approve_gate(run.id, Stage::GateA, first_device)
        .await
        .expect("current gate approves once");
    assert!(matches!(
        approved.gate_states[&Stage::GateA],
        GateState::Approved { by, .. } if by == first_device
    ));

    // A second approval, rejection, or change request on the same gate is refused.
    let second = engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect_err("second approval must be refused");
    assert!(
        matches!(second, crate::PipelineError::GateNotPending(Stage::GateA)),
        "unexpected error: {second:?}"
    );

    let reject_after = engine
        .reject_gate(run.id, Stage::GateA, "late".to_string(), DeviceId::new())
        .await
        .expect_err("reject after approval must be refused");
    assert!(matches!(
        reject_after,
        crate::PipelineError::GateNotPending(Stage::GateA)
    ));

    let changes_after = engine
        .request_changes(run.id, Stage::GateA, "late".to_string(), DeviceId::new())
        .await
        .expect_err("request_changes after approval must be refused");
    assert!(matches!(
        changes_after,
        crate::PipelineError::GateNotPending(Stage::GateA)
    ));

    let events = store.get_events(run.id).await.expect("events reload");
    let decisions: Vec<_> = events
        .iter()
        .filter(|e| e.kind == EventKind::GateDecision)
        .collect();
    assert_eq!(decisions.len(), 1, "only one GateDecision event recorded");
    assert_eq!(decisions[0].device_id, Some(first_device));
}

#[cfg(test)]
#[tokio::test]
async fn the_gate_decision_event_carries_the_artifacts_hash() {
    use chrono::Utc;
    use warsha_core::{Artifact, DeviceId, EventKind, Role, Stage};

    let (store, engine, project_id) = test_engine().await;
    let run = engine
        .start_run(project_id, "Build a clinic scheduler")
        .await
        .expect("run starts");

    // Record an explicit artifact on the run before reaching GateA.
    engine
        .upsert_artifact(
            run.id,
            Artifact {
                name: "brief".to_string(),
                content: "Clinic scheduling MVP".to_string(),
                stage: Stage::Idea,
                role: Some(Role::Intake),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                version: 2,
            },
        )
        .await
        .expect("artifact upserts");

    let at_gate_a = engine
        .advance_stage(run.id)
        .await
        .expect("advance Idea -> GateA");
    let expected_hash = artifacts_sha256(&at_gate_a.artifacts);
    assert_eq!(expected_hash.len(), 64);
    assert!(expected_hash
        .chars()
        .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));

    engine
        .approve_gate(run.id, Stage::GateA, DeviceId::new())
        .await
        .expect("current gate approves");

    let events = store.get_events(run.id).await.expect("events reload");
    let decision = events
        .iter()
        .find(|e| e.kind == EventKind::GateDecision && e.stage == Stage::GateA)
        .expect("GateDecision event recorded");
    assert_eq!(
        decision.payload["artifacts_sha256"].as_str(),
        Some(expected_hash.as_str())
    );

    // Changing an artifact produces a distinct artifacts_sha256 on the decision event.
    let run2 = engine
        .start_run(project_id, "Build a clinic scheduler")
        .await
        .expect("second run starts");
    engine
        .upsert_artifact(
            run2.id,
            Artifact {
                name: "brief".to_string(),
                content: "Clinic scheduling v2 — changed".to_string(),
                stage: Stage::Idea,
                role: Some(Role::Intake),
                created_at: Utc::now(),
                updated_at: Utc::now(),
                version: 3,
            },
        )
        .await
        .expect("artifact upserts on run2");
    let run2_at_gate = engine
        .advance_stage(run2.id)
        .await
        .expect("run2 Idea -> GateA");
    let expected_hash_2 = artifacts_sha256(&run2_at_gate.artifacts);
    assert_ne!(expected_hash, expected_hash_2);

    engine
        .reject_gate(
            run2.id,
            Stage::GateA,
            "needs revision".to_string(),
            DeviceId::new(),
        )
        .await
        .expect("current gate rejects");
    let events2 = store.get_events(run2.id).await.expect("events reload");
    let decision2 = events2
        .iter()
        .find(|e| e.kind == EventKind::GateDecision && e.stage == Stage::GateA)
        .expect("GateDecision event recorded on run2");
    assert_eq!(
        decision2.payload["artifacts_sha256"].as_str(),
        Some(expected_hash_2.as_str())
    );
}

#[cfg(test)]
#[test]
fn sha256_matches_fips_180_4_test_vectors() {
    let mut empty = Sha256::new();
    empty.update(b"");
    assert_eq!(
        empty.finalize_hex(),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );

    let mut abc = Sha256::new();
    abc.update(b"abc");
    assert_eq!(
        abc.finalize_hex(),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}
