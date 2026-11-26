pub struct Money {
    pub cents: i64,
}

impl Money {
    pub fn checked_add(self, other: Money) -> Option<Money> {
        self.cents
            .checked_add(other.cents)
            .map(|cents| Money { cents })
    }
}
