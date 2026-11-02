//! Bounded inbound rate limiting (security audit H-01).
//!
//! Both the daemon and the relay put a ceiling on what one caller may ask for, and
//! answer `429 Too Many Requests` (or the RPC equivalent) once it is reached. The
//! ceiling is a token bucket keyed on an **authenticated identity** — a device or a
//! session — where the transport has one, and on a **peer address** where it does
//! not. The two numbers a bucket carries are the two ceilings the audit asked for:
//!
//! - `burst` is how many requests one caller may make at once — the bucket's
//!   capacity, and what a retrying client is allowed to do in a single moment.
//! - `sustained` is how many requests per `window` it may keep making forever —
//!   the rate the bucket refills at, and the only number that bounds an attacker
//!   willing to be slow.
//!
//! Buckets live in a map with a hard `max_keys` bound, because a limiter that grows
//! with the traffic it measures is a denial-of-service tool of its own. When the map
//! is full of keys that have not gone idle, a *new* key is refused rather than
//! admitted: the limiter fails closed, the way every other check in this stack does.
//!
//! Refusals are *counted* rather than streamed. A limiter that writes one line per
//! refused request turns the thing that protects the daemon into the thing that fills
//! its disk — the measured spike run wrote 1,335,523 `WARN` lines / 161 MB in thirty
//! seconds from one loopback client (`bridge-io/security/load/report.md`, finding 2) —
//! so [`RefusalMeter`] aggregates per ceiling and per caller and answers with at most
//! one line per interval, naming counts and a one-way digest of the caller and never
//! the credential, the identity or the peer address it was keyed on.

use ring::digest;
use std::collections::HashMap;
use std::fmt;
use std::hash::Hash;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

/// How much traffic one key may carry.
///
/// `sustained` requests per `window`, up to `burst` of them at once. A `sustained`
/// of `0` is a pure burst: the bucket spends its `burst` tokens and never refills.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Quota {
    /// The bucket's capacity: the most requests allowed in one moment.
    pub burst: u32,
    /// The most requests allowed across `window` in steady state.
    pub sustained: u32,
    /// The interval `sustained` is measured over.
    pub window: Duration,
}

impl Quota {
    /// A quota of `burst` at once and `sustained` per `window_secs`.
    ///
    /// A window of zero seconds is raised to one millisecond rather than divided by
    /// zero: a quota that cannot be interpreted is not a quota its author meant.
    pub const fn new(burst: u32, sustained: u32, window_secs: u64) -> Self {
        let window = if window_secs == 0 {
            Duration::from_millis(1)
        } else {
            Duration::from_secs(window_secs)
        };
        Self {
            burst,
            sustained,
            window,
        }
    }

    /// The tighter of two quotas, which is how a request covered by two policies —
    /// an authenticated device *and* a paid-model call — is measured: the strictest
    /// limit wins, as the audit requires.
    ///
    /// Tightness is the sustained rate; the burst and window travel with whichever
    /// quota lost, so the result is one coherent bucket rather than a mix of two.
    pub fn strictest(self, other: Quota) -> Quota {
        if other.refill_per_sec() < self.refill_per_sec() {
            other
        } else {
            self
        }
    }

    /// The tightest quota of any number of policies, and the loosest when there is
    /// nothing to compare: a request under one policy is measured by that policy.
    pub fn tightest_of(quota: Quota, others: impl IntoIterator<Item = Quota>) -> Quota {
        others
            .into_iter()
            .fold(quota, |tight, candidate| tight.strictest(candidate))
    }

    /// Tokens restored per second, for comparing two quotas.
    fn refill_per_sec(self) -> f64 {
        if self.sustained == 0 {
            return 0.0;
        }
        f64::from(self.sustained) / self.window.as_secs_f64()
    }
}

impl Default for Quota {
    fn default() -> Self {
        // A generous default, because a quota is a deployment's policy and silence
        // is not: a caller that names none gets one only a flood would reach.
        Self::new(600, 600, 60)
    }
}

/// What the limiter decided about one request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    /// The request is served. `remaining` is the whole tokens left in the bucket.
    Allowed {
        /// Tokens left after this one was spent.
        remaining: u32,
    },
    /// The request is refused. `retry_after` is how long the caller should wait.
    Denied {
        /// How long until the bucket holds one more token.
        retry_after: Duration,
    },
}

impl Decision {
    /// True when the request may proceed.
    pub fn is_allowed(self) -> bool {
        matches!(self, Decision::Allowed { .. })
    }

    /// The value for a `Retry-After` header: whole seconds, and at least one when
    /// the request was refused. A refusal that says `0` tells a client to hammer
    /// again immediately, which is the opposite of what a refusal is for.
    pub fn retry_after_secs(self) -> u64 {
        match self {
            Decision::Allowed { .. } => 0,
            Decision::Denied { retry_after } => {
                let secs = retry_after.as_secs();
                if retry_after.subsec_nanos() > 0 {
                    secs + 1
                } else {
                    secs.max(1)
                }
            }
        }
    }
}

/// The default bound on tracked keys per limiter.
pub const DEFAULT_MAX_KEYS: usize = 4096;

/// The key a request is measured under.
///
/// The order is the policy the audit asks for: an **authenticated identity** decides
/// the bucket when the transport resolved one, a **peer address** is the fallback
/// when the caller is not yet authenticated (a failed token check is still that
/// caller's traffic), and a request with neither shares one bounded bucket rather
/// than going unmeasured. A fallback key is never a *wider* allowance than the
/// identity key it stands in for, so a caller cannot dodge a limit by failing to
/// authenticate.
pub fn rate_key(authenticated: Option<&str>, peer: Option<std::net::SocketAddr>) -> String {
    match (authenticated, peer) {
        (Some(identity), _) => format!("identity:{identity}"),
        (None, Some(address)) => format!("peer:{address}"),
        (None, None) => "anonymous".to_string(),
    }
}

/// One caller's bucket: its quota, its tokens, and when it was last refilled.
#[derive(Debug, Clone, Copy)]
struct Bucket {
    quota: Quota,
    /// Whole and fractional tokens; a request spends one.
    tokens: f64,
    last_refill: Instant,
}

impl Bucket {
    fn new(quota: Quota, at: Instant) -> Self {
        Self {
            quota,
            tokens: f64::from(quota.burst),
            last_refill: at,
        }
    }

    /// Add the tokens `now` has earned since the last refill, capped at the burst.
    ///
    /// The cap is the sustained ceiling: a bucket left alone for an hour does not
    /// owe its caller an hour's worth of requests all at once.
    fn refill(&mut self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.last_refill);
        if elapsed.is_zero() {
            return;
        }
        self.last_refill = now;
        if self.quota.sustained == 0 {
            return;
        }
        let earned = f64::from(self.quota.sustained) * elapsed.as_secs_f64()
            / self.quota.window.as_secs_f64();
        self.tokens = (self.tokens + earned).min(f64::from(self.quota.burst));
    }

    /// Spend one token, or refuse.
    fn spend(&mut self) -> Decision {
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            Decision::Allowed {
                remaining: self.tokens.floor().max(0.0) as u32,
            }
        } else {
            Decision::Denied {
                retry_after: self.retry_after(),
            }
        }
    }

    /// How long until this bucket holds one token.
    fn retry_after(&self) -> Duration {
        if self.tokens >= 1.0 {
            return Duration::from_millis(1);
        }
        if self.quota.sustained == 0 {
            // A spent pure-burst bucket has no refill to wait on, so the caller is
            // pointed at the window rather than at a zero it would ignore.
            return self.quota.window;
        }
        let deficit = 1.0 - self.tokens;
        let secs = deficit * self.quota.window.as_secs_f64() / f64::from(self.quota.sustained);
        Duration::from_secs_f64(secs.max(0.001))
    }

    /// True when the bucket is back at its burst ceiling, and so carries no history
    /// worth keeping: a new request from it would be served either way.
    fn is_full(&self) -> bool {
        self.tokens >= f64::from(self.quota.burst)
    }
}

/// A bounded map of per-key token buckets.
///
/// `K` is the caller's identity: a device id, a session, a peer address. The
/// limiter does not decide what a key *is* — that is its caller's trust boundary —
/// it only refuses to grow without bound and to serve past the quota.
///
/// The lock is a `std` mutex and is never held across an `await`: the whole of
/// [`RateLimiter::check`] is a map lookup and two float adds, and a limiter that
/// queued on an async lock would add latency to every request it exists to bound.
pub struct RateLimiter<K> {
    buckets: Mutex<HashMap<K, Bucket>>,
    quota: Quota,
    max_keys: usize,
}

impl<K> fmt::Debug for RateLimiter<K>
where
    K: Eq + Hash + Clone,
{
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RateLimiter")
            .field("quota", &self.quota)
            .field("tracked_keys", &self.len())
            .field("max_keys", &self.max_keys)
            .finish_non_exhaustive()
    }
}

impl<K> RateLimiter<K>
where
    K: Eq + Hash + Clone,
{
    /// A limiter for `quota`, tracking at most [`DEFAULT_MAX_KEYS`] keys.
    pub fn new(quota: Quota) -> Self {
        Self::bounded(quota, DEFAULT_MAX_KEYS)
    }

    /// A limiter for `quota` that will not track more than `max_keys` keys.
    ///
    /// `max_keys` of zero is raised to one: a limiter that can track nothing would
    /// refuse every request forever, and that is a broken limiter rather than a
    /// strict one.
    pub fn bounded(quota: Quota, max_keys: usize) -> Self {
        Self {
            buckets: Mutex::new(HashMap::new()),
            quota,
            max_keys: max_keys.max(1),
        }
    }

    /// The policy this limiter enforces.
    pub fn quota(&self) -> Quota {
        self.quota
    }

    /// How many keys this limiter will track before it fails closed.
    pub fn max_keys(&self) -> usize {
        self.max_keys
    }

    /// Spend one token for `key`, measured at the current instant.
    pub fn check(&self, key: &K) -> Decision {
        self.check_at(key, Instant::now())
    }

    /// Spend one token for `key` as if `now` were the current instant.
    ///
    /// Separate from [`RateLimiter::check`] so a test can move a bucket's clock by
    /// minutes rather than sleeping them: the arithmetic a limiter is judged on has
    /// to be observable, and a rate-limit test that passes only while the machine
    /// is fast is not a test.
    pub fn check_at(&self, key: &K, now: Instant) -> Decision {
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);

        if let Some(bucket) = buckets.get_mut(key) {
            bucket.refill(now);
            return bucket.spend();
        }

        // A new key: make room first, then open its bucket at the burst ceiling.
        if buckets.len() >= self.max_keys {
            buckets.retain(|_, bucket| {
                bucket.refill(now);
                !bucket.is_full()
            });
            if buckets.len() >= self.max_keys {
                // Fail closed: an unbounded stream of distinct identities is the
                // flood this bound exists to survive, and admitting one more would
                // trade the caller's CPU for the limiter's memory.
                return Decision::Denied {
                    retry_after: self.quota.window,
                };
            }
        }

        let mut bucket = Bucket::new(self.quota, now);
        let decision = bucket.spend();
        buckets.insert(key.clone(), bucket);
        decision
    }

    /// The tokens `key` currently holds, without spending one.
    pub fn peek(&self, key: &K) -> Option<u32> {
        let mut buckets = self.buckets.lock().unwrap_or_else(PoisonError::into_inner);
        buckets.get_mut(key).map(|bucket| {
            bucket.refill(Instant::now());
            bucket.tokens.floor().max(0.0) as u32
        })
    }

    /// Keys currently tracked, for a test or a status report.
    pub fn len(&self) -> usize {
        self.buckets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .len()
    }

    /// True when nothing has been measured yet.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Forget every bucket: what a caller does when the policy changes, so the
    /// history of a quota that no longer exists does not decide the next request.
    pub fn clear(&self) {
        self.buckets
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clear();
    }
}

/// How often one ceiling may write about one caller.
///
/// A minute is the window the quotas themselves are measured over, so a line lands
/// often enough to notice and rarely enough that a flood cannot afford to write one.
pub const DEFAULT_REFUSAL_LOG_INTERVAL: Duration = Duration::from_secs(60);

/// How many `(ceiling, caller)` pairs a [`RefusalMeter`] keeps tallies for.
///
/// Deliberately far below [`DEFAULT_MAX_KEYS`]: the meter describes traffic rather than
/// deciding it, so it has no business holding one entry per live bucket when a summary of
/// the traffic is what an operator reads.
pub const DEFAULT_MAX_REFUSAL_KEYS: usize = 256;

/// The ceiling name on the line the meter writes when its own bound is reached.
pub const OVERFLOW_CEILING: &str = "untracked";

/// One log-worthy refusal tally, handed back by [`RefusalMeter::note`] when it is the
/// moment to write a line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefusalSummary {
    /// Which ceiling refused: a tier, a method name, an endpoint, or
    /// [`OVERFLOW_CEILING`].
    pub ceiling: &'static str,
    /// A one-way digest of the caller's limiter key — never the key itself.
    pub caller: String,
    /// Refusals counted for this pair since the last line was written.
    pub since_last_line: u64,
    /// Refusals counted for this pair in this process's life.
    pub total: u64,
    /// How many pairs the meter is holding tallies for right now.
    pub tracked_callers: usize,
    /// Refusals counted for callers beyond the meter's bound.
    pub untracked: u64,
    /// Every refusal the meter has counted, tracked or not.
    pub refusals_total: u64,
}

impl RefusalSummary {
    /// The line an operator sees.
    ///
    /// Counts, a ceiling and a digest — nothing else. The limiter key a bucket is keyed
    /// on is an authenticated identity (`identity:<device>`), a peer address, or the
    /// shared fallback for a caller that presented no accepted credential. None of those
    /// belong in a log a support bundle ships, and a credential never belongs in any of
    /// them, which is why the meter takes the key and prints only what it cannot be
    /// turned back into.
    pub fn message(&self) -> String {
        format!(
            "{} requests refused at the `{}` ceiling (caller {}, {} since the last line, \
             {} total; {} callers tracked, {} untracked, {} refusals in total)",
            self.since_last_line,
            self.ceiling,
            self.caller,
            self.since_last_line,
            self.total,
            self.tracked_callers,
            self.untracked,
            self.refusals_total,
        )
    }
}

/// One `(ceiling, caller)` pair's counter.
#[derive(Debug, Clone, Copy)]
struct RefusalTally {
    /// Refusals counted since the last line was written for this pair.
    since_last_line: u64,
    /// Refusals counted since the process started.
    total: u64,
    /// When the last line about this pair was written.
    last_logged: Instant,
}

/// What the meter does with callers it has no tally room left for: one aggregate count,
/// with its own line cadence.
#[derive(Debug, Default)]
struct Overflow {
    /// Overflow refusals counted.
    counted: u64,
    /// How many of them the last emitted line covered.
    last_reported: u64,
}

/// A bounded, aggregating count of limiter refusals.
///
/// Three properties, each one the answer to something the measured spike run showed
/// (`bridge-io/security/load/report.md`, finding 2: 1,335,523 `WARN` lines and 161 MB in
/// thirty seconds from one loopback client):
///
/// - **One line per interval per pair, not one per refusal.** A refused request adds one
///   to a counter; the counter speaks at most once per [`RefusalMeter::interval`]. The
///   first refusal for a pair always speaks — a ceiling that starts binding is news —
///   and after that the cadence is the interval.
/// - **Bounded in memory.** The tallies live in a map capped at `max_keys`, and a caller
///   beyond the bound folds into a single [`Overflow`] total instead of growing the meter.
///   Same fail-closed choice [`RateLimiter`] makes about its buckets, same reason: a
///   counter that scales with the traffic it measures is a second denial of service for
///   the first one to hand out.
/// - **Silent about credentials.** A caller is named by a truncated SHA-256 of its
///   limiter key — enough for an operator to line two lines up with the same noisy
///   caller, and nothing a reader of the log can present back as a token, an identity or
///   an address.
#[derive(Debug)]
pub struct RefusalMeter {
    /// Tallies by `(ceiling, caller digest)`, bounded by `max_keys`.
    tallies: Mutex<HashMap<(String, String), RefusalTally>>,
    /// Refusals for callers the map has no room for.
    overflow: Mutex<Overflow>,
    /// Every refusal counted, tracked or not.
    total: Mutex<u64>,
    /// How many lines the meter has handed back to be written. This is the number a test
    /// and a status report read to check the bound: refusals are in the millions on a
    /// flood, lines are in the single digits, and "one per interval" is a claim that has
    /// to be *countable* rather than observed in a log someone else may or may not be
    /// collecting.
    lines_written: Mutex<u64>,
    interval: Duration,
    max_keys: usize,
}

impl Default for RefusalMeter {
    fn default() -> Self {
        Self::new(DEFAULT_REFUSAL_LOG_INTERVAL, DEFAULT_MAX_REFUSAL_KEYS)
    }
}

impl RefusalMeter {
    /// A meter that writes about one ceiling and one caller at most once per `interval`
    /// and keeps tallies for at most `max_keys` pairs.
    ///
    /// An interval of zero is raised to one millisecond and a bound of zero to one pair:
    /// a meter that wrote every refusal or that refused to track anything would both be
    /// broken, and neither is what a caller meant when it passed a mis-scaled number.
    pub fn new(interval: Duration, max_keys: usize) -> Self {
        Self {
            tallies: Mutex::new(HashMap::new()),
            overflow: Mutex::new(Overflow::default()),
            total: Mutex::new(0),
            lines_written: Mutex::new(0),
            interval: interval.max(Duration::from_millis(1)),
            max_keys: max_keys.max(1),
        }
    }

    /// The interval between two lines about the same pair.
    pub fn interval(&self) -> Duration {
        self.interval
    }

    /// How many pairs are tallied before callers fold into the overflow total.
    pub fn max_keys(&self) -> usize {
        self.max_keys
    }

    /// How many pairs are tallied right now.
    pub fn tracked(&self) -> usize {
        self.lock().len()
    }

    /// Every refusal counted since the process started, tracked or not.
    pub fn refusals_total(&self) -> u64 {
        *self.total.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Refusals counted for callers the meter would not track.
    pub fn untracked(&self) -> u64 {
        self.lock_overflow().counted
    }

    /// How many lines this meter has said should be written.
    ///
    /// The bound as a number: 1.3M refusals is `refusals_total`, one line per interval per
    /// caller is `lines_written`. A caller that logs on the answer compares the two; a test
    /// asserts on them; nobody has to scrape a log to learn whether the meter is holding.
    pub fn lines_written(&self) -> u64 {
        *self
            .lines_written
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// Count one refusal and answer with the line to write, if this is the moment for
    /// one.
    ///
    /// `caller_key` is the key the limiter itself measured the request under — see
    /// [`rate_key`]. It is digested and dropped, never stored and never printed, so a
    /// caller that keyed a bucket on something secret cannot leak it through the log.
    /// `now` is the caller's clock rather than the meter's, which is what lets a test
    /// prove the cadence without sleeping: the same reason [`RateLimiter::check_at`]
    /// takes one.
    pub fn note(
        &self,
        ceiling: &'static str,
        caller_key: &str,
        now: Instant,
    ) -> Option<RefusalSummary> {
        let caller = caller_digest(caller_key);
        let refusals_total = {
            let mut total = self.total.lock().unwrap_or_else(PoisonError::into_inner);
            *total = total.saturating_add(1);
            *total
        };

        let mut tallies = self.lock();
        let key = (ceiling.to_string(), caller.clone());
        if let Some(tally) = tallies.get_mut(&key) {
            tally.total = tally.total.saturating_add(1);
            if now.saturating_duration_since(tally.last_logged) < self.interval {
                tally.since_last_line = tally.since_last_line.saturating_add(1);
                return None;
            }
            let since_last_line = tally.since_last_line.saturating_add(1);
            tally.since_last_line = 0;
            tally.last_logged = now;
            let overflow = self.lock_overflow();
            self.mark_written();
            return Some(RefusalSummary {
                ceiling,
                caller,
                since_last_line,
                total: tally.total,
                tracked_callers: tallies.len(),
                untracked: overflow.counted,
                refusals_total,
            });
        }

        if tallies.len() >= self.max_keys {
            // No room for another pair. The refusal is still counted, in one aggregate,
            // and the meter speaks about the aggregate once for every `max_keys`
            // refusals it folds in — bounded in both directions, and loud enough that a
            // saturated meter is visible rather than silent.
            let mut overflow = self.lock_overflow();
            overflow.counted = overflow.counted.saturating_add(1);
            let folded_in = overflow.counted - overflow.last_reported;
            if folded_in < self.max_keys as u64 {
                return None;
            }
            overflow.last_reported = overflow.counted;
            let counted = overflow.counted;
            drop(overflow);
            let tracked = tallies.len();
            drop(tallies);
            self.mark_written();
            return Some(RefusalSummary {
                ceiling: OVERFLOW_CEILING,
                caller: "no tally room".to_string(),
                since_last_line: folded_in,
                total: counted,
                tracked_callers: tracked,
                untracked: counted,
                refusals_total,
            });
        }

        tallies.insert(
            key,
            RefusalTally {
                since_last_line: 0,
                total: 1,
                last_logged: now,
            },
        );
        let overflow = self.lock_overflow();
        self.mark_written();
        Some(RefusalSummary {
            ceiling,
            caller,
            since_last_line: 1,
            total: 1,
            tracked_callers: tallies.len(),
            untracked: overflow.counted,
            refusals_total,
        })
    }

    /// Record that a line is being handed to the caller to write.
    fn mark_written(&self) {
        let mut written = self
            .lines_written
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        *written = written.saturating_add(1);
    }

    /// The tally map, with a poisoned lock read as the panic it is rather than
    /// panicking again in a refusal path.
    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<(String, String), RefusalTally>> {
        self.tallies.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The overflow counter, poisoned or not.
    fn lock_overflow(&self) -> std::sync::MutexGuard<'_, Overflow> {
        self.overflow.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The loggable name of a limiter key: four bytes of SHA-256 in hex.
///
/// Short because it is a correlation handle, not an identifier: eight hex characters
/// distinguish the callers one daemon actually logs from each other, and are not a
/// credential, an identity or an address. The digest is one-way, so a reader of the log
/// cannot recover the key from it and a caller cannot present it back as proof of
/// anything.
pub fn caller_digest(caller_key: &str) -> String {
    let hash = digest::digest(&digest::SHA256, caller_key.as_bytes());
    let mut out = String::with_capacity(8);
    for byte in hash.as_ref().iter().take(4) {
        use std::fmt::Write as _;
        let _ = write!(&mut out, "{byte:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A quota with a one-minute window, which is the shape a daemon's tiers use.
    fn per_minute(burst: u32, sustained: u32) -> Quota {
        Quota::new(burst, sustained, 60)
    }

    #[test]
    fn a_caller_is_served_up_to_its_burst_and_then_refused() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(3, 60));

        for expected in [2, 1, 0] {
            assert_eq!(
                limiter.check_at(&"device-a", start),
                Decision::Allowed {
                    remaining: expected
                }
            );
        }

        let denied = limiter.check_at(&"device-a", start);
        assert!(
            !denied.is_allowed(),
            "the fourth request of a burst of 3 was served: {denied:?}"
        );
        assert!(
            denied.retry_after_secs() >= 1,
            "a refusal named no wait the client can act on"
        );
    }

    #[test]
    fn a_refusal_names_a_retry_after_and_an_allowed_request_does_not() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(1, 60));
        assert_eq!(limiter.check_at(&"peer", start).retry_after_secs(), 0);
        assert!(limiter.check_at(&"peer", start).retry_after_secs() >= 1);
    }

    #[test]
    fn the_sustained_ceiling_refills_the_bucket_over_the_window() {
        let start = Instant::now();
        // Burst 2, sustained 60/minute == one token per second.
        let limiter = RateLimiter::new(per_minute(2, 60));
        assert!(limiter.check_at(&"device-a", start).is_allowed());
        assert!(limiter.check_at(&"device-a", start).is_allowed());
        assert!(
            !limiter.check_at(&"device-a", start).is_allowed(),
            "the burst was exhausted and yet a third request was served"
        );

        // One second of sustained rate is one token.
        let one_sec = start + Duration::from_secs(1);
        assert!(limiter.check_at(&"device-a", one_sec).is_allowed());
        assert!(!limiter.check_at(&"device-a", one_sec).is_allowed());

        // A minute of it refills to the burst ceiling, and no further.
        let minute_later = one_sec + Duration::from_secs(60);
        assert!(limiter.check_at(&"device-a", minute_later).is_allowed());
        assert!(limiter.check_at(&"device-a", minute_later).is_allowed());
        assert!(
            !limiter.check_at(&"device-a", minute_later).is_allowed(),
            "an idle bucket returned more than its burst ceiling"
        );
    }

    #[test]
    fn one_key_exhaustion_does_not_answer_for_another() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(1, 60));

        assert!(limiter.check_at(&"owner", start).is_allowed());
        assert!(!limiter.check_at(&"owner", start).is_allowed());
        assert!(
            limiter.check_at(&"phone-2", start).is_allowed(),
            "a second device was refused for a first device's traffic"
        );
    }

    #[test]
    fn the_key_map_is_bounded_and_a_new_key_fails_closed_when_it_is_full() {
        let start = Instant::now();
        let limiter = RateLimiter::bounded(per_minute(2, 120), 2);

        // Two keys fill the map, each with a token still spent (so neither is full).
        assert!(limiter.check_at(&"a", start).is_allowed());
        assert!(limiter.check_at(&"b", start).is_allowed());
        assert_eq!(limiter.len(), 2);

        // A third identity cannot be tracked, and is refused rather than admitted.
        let third = limiter.check_at(&"c", start);
        assert!(
            !third.is_allowed(),
            "a limiter at its key bound admitted a new key"
        );
        assert_eq!(limiter.len(), 2, "the bound on tracked keys is not a bound");
        assert!(third.retry_after_secs() >= 1);

        // The keys already tracked are unaffected by the refusal.
        assert!(limiter.check_at(&"a", start).is_allowed());
    }

    #[test]
    fn a_bucket_that_has_refilled_to_full_is_pruned_and_its_slot_reused() {
        let start = Instant::now();
        let limiter = RateLimiter::bounded(per_minute(1, 60), 1);

        assert!(limiter.check_at(&"a", start).is_allowed());
        assert_eq!(limiter.len(), 1);

        // `a` is spent, and a window of sustained refill puts it back at the
        // ceiling — where it carries no history worth keeping, so its slot is
        // recycled for the next identity instead of held forever.
        let idle = start + Duration::from_secs(60);
        assert!(limiter.check_at(&"a", idle).is_allowed());
        assert!(limiter
            .check_at(&"b", idle + Duration::from_secs(60))
            .is_allowed());
        assert_eq!(
            limiter.len(),
            1,
            "a bucket that had refilled to full kept its slot"
        );
    }

    #[test]
    fn a_pure_burst_quota_never_refills() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(2, 0));
        assert!(limiter.check_at(&"a", start).is_allowed());
        assert!(limiter.check_at(&"a", start).is_allowed());
        let much_later = start + Duration::from_secs(3600);
        assert!(
            !limiter.check_at(&"a", much_later).is_allowed(),
            "a sustained of 0 still refilled"
        );
    }

    #[test]
    fn the_strictest_of_two_quotas_wins() {
        let standard = per_minute(600, 600);
        let pairing = per_minute(5, 6);

        assert_eq!(standard.strictest(pairing), pairing);
        assert_eq!(pairing.strictest(standard), pairing);
        // A slower sustained rate is stricter even with a much larger burst.
        let slow_but_bursty = per_minute(100, 30);
        assert_eq!(pairing.strictest(slow_but_bursty), pairing);
        assert_eq!(slow_but_bursty.strictest(standard), slow_but_bursty);
        assert_eq!(
            Quota::tightest_of(standard, [slow_but_bursty, pairing]),
            pairing,
            "a request under three policies was not measured by the strictest"
        );
        // One policy alone is measured by itself.
        assert_eq!(Quota::tightest_of(pairing, []), pairing);
    }

    #[test]
    fn a_zero_window_is_not_a_division_by_zero() {
        let quota = Quota::new(1, 1, 0);
        assert!(quota.window > Duration::ZERO);
        let start = Instant::now();
        let limiter = RateLimiter::new(quota);
        assert!(limiter.check_at(&"a", start).is_allowed());
        assert!(!limiter.check_at(&"a", start).is_allowed());
        assert!(limiter.check_at(&"a", start + quota.window).is_allowed());
    }

    #[test]
    fn peek_reports_the_bucket_without_spending_a_token() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(2, 60));
        assert_eq!(limiter.peek(&"a"), None, "an unknown key has a bucket");

        assert!(limiter.check_at(&"a", start).is_allowed());
        assert_eq!(limiter.peek(&"a"), Some(1));
        assert_eq!(limiter.peek(&"a"), Some(1), "peek spent a token");
    }

    #[test]
    fn an_authenticated_identity_keys_the_bucket_and_a_peer_is_the_fallback() {
        use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4};

        let peer = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 4321));

        // Where the transport resolved who is calling, that is what is measured.
        assert_eq!(
            rate_key(Some("device-1"), Some(peer)),
            "identity:device-1",
            "a peer address was preferred over an authenticated device"
        );
        // Where it did not, the address stands in — and two peers do not share one
        // bucket, or one caller's traffic would refuse another's.
        let other_peer = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 4322));
        assert_eq!(rate_key(None, Some(peer)), format!("peer:{peer}"));
        assert_ne!(
            rate_key(None, Some(peer)),
            rate_key(None, Some(other_peer)),
            "two peers were measured against one bucket"
        );
        // And a request with neither is still bounded, not unmeasured.
        assert_eq!(rate_key(None, None), "anonymous");
    }

    #[test]
    fn clearing_forgets_the_history_of_a_changed_policy() {
        let start = Instant::now();
        let limiter = RateLimiter::new(per_minute(1, 60));
        assert!(limiter.check_at(&"a", start).is_allowed());
        assert!(!limiter.check_at(&"a", start).is_allowed());

        limiter.clear();
        assert!(limiter.is_empty());
        assert_eq!(limiter.max_keys(), DEFAULT_MAX_KEYS);
        assert!(limiter.check_at(&"a", start).is_allowed());
    }

    // ---- LOAD-1 finding 2: refusals are counted, not streamed.

    /// The number the measured spike run refused with
    /// (`bridge-io/security/load/report.md`), and the log it wrote: 161 MB. The meter's
    /// whole claim is that the first number stays a number and the second never happens.
    #[test]
    fn a_flood_of_refusals_writes_one_line_and_not_one_line_per_refusal() {
        let start = Instant::now();
        let meter = RefusalMeter::new(Duration::from_secs(60), 16);
        let refused = 1_335_517usize;

        let mut lines = 0usize;
        for _ in 0..refused {
            if meter.note("transport", "identity:owner", start).is_some() {
                lines += 1;
            }
        }

        assert_eq!(
            lines, 1,
            "one line per interval for one caller is the whole log a flood earns"
        );
        assert_eq!(
            meter.lines_written(),
            1,
            "the meter's own count of lines it handed out disagrees with the caller's"
        );
        assert_eq!(meter.refusals_total(), refused as u64);
        assert_eq!(meter.tracked(), 1, "one caller, one tally");

        // The next interval's line names the count that accumulated underneath it, so
        // folding 1.3M refusals into one line does not lose the measurement.
        let later = start + Duration::from_secs(61);
        let line = meter
            .note("transport", "identity:owner", later)
            .expect("the interval passed and the meter speaks again");
        // One refusal inside the interval was counted, and this one is the next: the
        // line carries both, which is the whole point of aggregating rather than
        // streaming.
        assert_eq!(line.since_last_line, refused as u64);
        assert_eq!(line.total, refused as u64 + 1);
        assert!(line.message().contains("transport"));
    }

    /// The bound is on the meter's own memory, the same way it is on the limiter's: a
    /// flood of *distinct* callers is the traffic that would otherwise grow it.
    #[test]
    fn the_meter_is_bounded_and_folds_extra_callers_into_one_aggregate() {
        let start = Instant::now();
        let meter = RefusalMeter::new(Duration::from_secs(60), 4);

        let mut lines = 0usize;
        for index in 0..1_000u32 {
            let key = rate_key(
                None,
                Some(std::net::SocketAddr::from(([10, 0, 0, 1], index as u16))),
            );
            if meter.note("transport", &key, start).is_some() {
                lines += 1;
            }
        }

        assert_eq!(meter.tracked(), 4, "the tally map grew past its bound");
        assert_eq!(meter.untracked(), 996);
        assert_eq!(meter.refusals_total(), 1_000);
        assert_eq!(
            meter.lines_written() as usize,
            lines,
            "the line count the meter reports is not the count the caller saw"
        );
        // Four opening lines, then the overflow speaks once per `max_keys` refusals
        // folded in rather than once per caller.
        assert!(
            lines <= 4 + (996 / 4) + 1,
            "the overflow line was written {lines} times for one ceiling"
        );

        // Every refusal is still counted even though most of the callers have no tally,
        // and the aggregate still speaks on a cadence of its own: one line per `max_keys`
        // refusals folded in, not one per caller.
        for _ in 0..3 {
            assert!(
                meter
                    .note(
                        "transport",
                        "peer:new-caller",
                        start + Duration::from_secs(600)
                    )
                    .is_none(),
                "the overflow spoke more often than once per bound"
            );
        }
        let overflow = meter
            .note(
                "transport",
                "peer:new-caller",
                start + Duration::from_secs(600),
            )
            .expect("a fourth folded-in refusal earns the aggregate line");
        assert_eq!(overflow.ceiling, OVERFLOW_CEILING);
        assert_eq!(overflow.since_last_line, 4);
        assert_eq!(meter.untracked(), 1_000);
        assert_eq!(meter.refusals_total(), 1_004);
    }

    /// What the requirement is really about: the log line carries counts and a digest.
    /// A token, an identity, a device id and a peer address all stay where they were.
    #[test]
    fn a_refusal_line_prints_counts_and_a_digest_and_never_the_caller_s_credential() {
        let start = Instant::now();
        let meter = RefusalMeter::default();
        let secret = "sk-or-v1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let device = "identity:phone-9c1f-42be";

        for key in [
            rate_key(Some(secret), None),
            rate_key(Some(device), None),
            "peer:203.0.113.9:55_55".to_string(),
        ] {
            let line = meter
                .note("standard", &key, start)
                .expect("the first refusal for a pair is written");
            let message = line.message();
            assert!(
                !message.contains(secret) && !message.contains(device),
                "a refusal line printed the caller: {message}"
            );
            assert!(
                !message.contains("203.0.113.9") && !message.contains("55_55"),
                "a refusal line printed a peer address: {message}"
            );
            assert!(
                message.contains(&line.caller),
                "the line did not name the caller by its digest: {message}"
            );
            assert_ne!(line.caller, key, "the digest is the key");
            assert_eq!(
                line.caller.len(),
                8,
                "a digest is eight hex characters: {}",
                line.caller
            );
            assert!(
                line.caller.chars().all(|c| c.is_ascii_hexdigit()),
                "unexpected digest: {}",
                line.caller
            );
        }

        // Two different callers get different digests, so an operator can still tell
        // which one is doing it, and the same caller always gets the same one.
        assert_eq!(
            caller_digest("identity:owner"),
            caller_digest("identity:owner")
        );
        assert_ne!(
            caller_digest("identity:owner"),
            caller_digest("identity:phone")
        );
    }

    /// The cadence, spelled out: a pair speaks on its first refusal, then once per
    /// interval, and refusals in between are counted rather than written.
    #[test]
    fn a_pair_speaks_when_it_starts_being_refused_and_then_once_per_interval() {
        let start = Instant::now();
        let meter = RefusalMeter::new(Duration::from_secs(30), 8);

        assert!(meter.note("spend", "identity:owner", start).is_some());
        for offset in 1..30u64 {
            assert!(
                meter
                    .note(
                        "spend",
                        "identity:owner",
                        start + Duration::from_secs(offset)
                    )
                    .is_none(),
                "the meter wrote a line inside its own interval"
            );
        }
        let line = meter
            .note("spend", "identity:owner", start + Duration::from_secs(30))
            .expect("the interval passed");
        // The first refusal wrote a line; 29 more were counted underneath it; this one
        // both reports those 29 and is itself a refusal, so the line carries 30.
        assert_eq!(line.since_last_line, 30);
        assert_eq!(line.total, 31);

        // A second ceiling on the same caller is its own pair with its own cadence: the
        // method tier is not silenced by the transport ceiling talking.
        assert!(meter.note("auth", "identity:owner", start).is_some());
        assert_eq!(meter.tracked(), 2);
    }
}
