pub fn add(a: i64, b: i64) -> i64 {
    match a.checked_add(b) {
        Some(sum) => sum,
        None if b > 0 => i64::MAX,
        None => i64::MIN,
    }
}
