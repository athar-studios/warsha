pub trait RateSource {
    fn rate_bps(&self) -> u32;
}
