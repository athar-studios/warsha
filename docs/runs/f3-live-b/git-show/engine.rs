pub fn apply_fee(amount: i64, bps: u32) -> Option<i64> {
    if bps > 10_000 {
        return None;
    }

    if amount == 0 {
        return Some(0);
    }

    let magnitude = amount.unsigned_abs() as u128;
    let fee = magnitude.checked_mul(u128::from(bps))?.checked_div(10_000)?;
    let total = magnitude.checked_add(fee)?;

    if amount > 0 {
        if total > i64::MAX as u128 {
            return None;
        }
        Some(total as i64)
    } else {
        if total > (i64::MAX as u128) + 1 {
            return None;
        }
        Some(-(total as i128) as i64)
    }
}
