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
