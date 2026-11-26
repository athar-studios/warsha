#[test]
fn proofcalc_contracts() {
    assert_eq!(proofcalc::add(2, 3), 5);
    assert_eq!(proofcalc::add(i64::MAX, 1), i64::MAX);
    assert_eq!(proofcalc::add(i64::MIN, -1), i64::MIN);

    let m = proofcalc::Money { cents: 40 }
        .checked_add(proofcalc::Money { cents: 2 });
    assert_eq!(m.map(|x| x.cents), Some(42));
    assert!(proofcalc::Money { cents: i64::MAX }
        .checked_add(proofcalc::Money { cents: 1 })
        .is_none());

    assert_eq!(proofcalc::apply_fee(10_000, 250), Some(10_250));
    assert_eq!(proofcalc::apply_fee(-10_000, 250), Some(-10_250));
    assert_eq!(proofcalc::apply_fee(0, 10_000), Some(0));
    assert_eq!(proofcalc::apply_fee(0, 10_001), None);

    struct FixedRate;
    impl proofcalc::RateSource for FixedRate {
        fn rate_bps(&self) -> u32 {
            250
        }
    }
    let src = FixedRate;
    assert_eq!(proofcalc::RateSource::rate_bps(&src), 250);
}
