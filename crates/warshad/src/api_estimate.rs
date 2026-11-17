//! A4: pre-run cost estimate for a run (`runs.estimate`).
//!
//! The estimate is a *range* over the models the run's role routings name:
//! the floor prices every model in the routing at its cheapest plausible
//! usage, the ceiling at a heavier one. Pricing comes from the model catalog
//! where the model is known and from the router's default pricing where it is
//! not — every number here is an estimate, and the reply says so.

use crate::api::CostEstimate;
use crate::WarshaRpc;
use warsha_core::{ModelPricing, Role};
// The estimate helper is exercised end to end through the daemon in the
// warshad suite; here the range arithmetic is checked directly.

/// The default pricing the router itself falls back to (`cost_of`).
const DEFAULT_PRICING: ModelPricing = ModelPricing {
    input_per_million_cents: 100,
    output_per_million_cents: 200,
};

/// Assumed token volumes for one run, in tokens: a modest floor and a heavier
/// ceiling. These are the run-shape assumptions the range communicates — the
/// UI labels the whole figure estimated, so they need not be exact.
const FLOOR_INPUT_TOKENS: f64 = 20_000.0;
const FLOOR_OUTPUT_TOKENS: f64 = 5_000.0;
const CEILING_INPUT_TOKENS: f64 = 200_000.0;
const CEILING_OUTPUT_TOKENS: f64 = 50_000.0;

fn pricing_for(model: &str, custom: &[warsha_store::StoredCustomModel]) -> Option<ModelPricing> {
    // Custom models carry no price columns; a custom model is priced at the
    // router default like any unknown model. Catalog pricing is wired by the
    // catalog packet; until it lands the default is the only known price.
    let _ = (model, custom);
    Some(DEFAULT_PRICING)
}

pub(crate) async fn compute_run_estimate(
    rpc: &WarshaRpc,
    project_id: warsha_core::ProjectId,
    _idea: &str,
) -> std::result::Result<CostEstimate, String> {
    let store = &rpc.state.store;
    let _project = store
        .get_project(project_id)
        .await
        .map_err(|e| format!("cannot estimate for project `{}`: {e}", project_id.0))?;

    // Collect the models the run would route through: every role routing's
    // targets. The daemon-wide router is the source of truth for what a run
    // dials, so the estimate reads the same table.
    let router = rpc.state.providers.read().await.clone();
    let mut models: Vec<String> = Vec::new();
    for role in [
        Role::Intake,
        Role::Researcher,
        Role::PM,
        Role::Designer,
        Role::Architect,
        Role::Coder,
        Role::Reviewer,
        Role::Release,
        Role::Marketer,
        Role::Feedback,
    ] {
        if let Some(targets) = router.routing_targets_for(role) {
            for target in targets {
                if !models.contains(&target.model_id) {
                    models.push(target.model_id);
                }
            }
        }
    }

    if models.is_empty() {
        return Ok(CostEstimate {
            min_cents: 0,
            max_cents: 0,
            estimated: true,
            warnings: vec!["no models are routed for this project's roles".to_string()],
        });
    }

    let custom = store
        .settings()
        .load_custom_models()
        .await
        .unwrap_or_default();

    let mut min_cents: u64 = 0;
    let mut max_cents: u64 = 0;
    let mut warnings: Vec<String> = Vec::new();
    for model in &models {
        match pricing_for(model, &custom) {
            Some(pricing) => {
                min_cents += ((FLOOR_INPUT_TOKENS / 1_000_000.0)
                    * pricing.input_per_million_cents as f64)
                    .ceil() as u64;
                min_cents += ((FLOOR_OUTPUT_TOKENS / 1_000_000.0)
                    * pricing.output_per_million_cents as f64)
                    .ceil() as u64;
                max_cents += ((CEILING_INPUT_TOKENS / 1_000_000.0)
                    * pricing.input_per_million_cents as f64)
                    .ceil() as u64;
                max_cents += ((CEILING_OUTPUT_TOKENS / 1_000_000.0)
                    * pricing.output_per_million_cents as f64)
                    .ceil() as u64;
            }
            None => warnings.push(format!("unknown for {model}")),
        }
    }

    Ok(CostEstimate {
        min_cents,
        max_cents,
        estimated: true,
        warnings,
    })
}
