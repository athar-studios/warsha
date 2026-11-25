#![allow(
    clippy::expect_used,
    clippy::panic,
    clippy::unwrap_used,
    unused_crate_dependencies
)]

use warsha_pipeline::swarm::BudgetReservations;

#[test]
fn test_budget_reservation() {
    let mut br = BudgetReservations::new(4);
    let run_budget = 1000;

    // cap = 1000 / 4 = 250
    assert!(br.try_reserve(0, run_budget).is_ok());
    assert!(br.try_reserve(0, run_budget).is_ok());
    assert!(br.try_reserve(0, run_budget).is_ok());
    assert!(br.try_reserve(0, run_budget).is_ok());

    // 5th subtask should fail
    assert_eq!(
        br.try_reserve(0, run_budget),
        Err("subtask budget cap reached".to_string())
    );
}

/// A few cents already spent must not refuse the lane the project asked for.
/// The old formula reserved `total / N` against the original total, so
/// `spent + N * (total / N)` exceeded the budget and the fourth lane waited.
#[test]
fn prior_spend_still_reserves_every_lane() {
    let mut br = BudgetReservations::new(4);
    let run_budget = 50_000;
    let spent = 5;
    for _ in 0..4 {
        assert!(br.try_reserve(spent, run_budget).is_ok());
    }
    assert_eq!(
        br.try_reserve(spent, run_budget),
        Err("subtask budget cap reached".to_string())
    );
    br.release();
    assert!(br.try_reserve(spent, run_budget).is_ok());
}
