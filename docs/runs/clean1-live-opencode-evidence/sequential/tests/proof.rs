#[test]
fn four_public_contracts() {
    assert_eq!(proofcalc::add(2, 3), 5);
    let total = proofcalc::Money { cents: 40 }
        .checked_add(proofcalc::Money { cents: 2 });
    assert_eq!(total.map(|money| money.cents), Some(42));
    assert_eq!(proofcalc::apply_fee(10_000, 250), Some(10_250));
    struct LocalRate;
    impl proofcalc::RateSource for LocalRate {
        fn rate_bps(&self) -> u32 {
            250
        }
    }
    assert_eq!(proofcalc::RateSource::rate_bps(&LocalRate), 250);
}
