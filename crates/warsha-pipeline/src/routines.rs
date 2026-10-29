//! Routines — a scheduled-task abstraction for Warsha's Simple-mode automations.
//!
//! Goose is **not** a dependency of this repository yet (the root `Cargo.toml`
//! carries it only as a commented-out placeholder), so routines are modelled
//! here in-house behind the [`RoutineRunner`] trait. A future Goose-backed
//! scheduler (recipes + cron) implements that trait and drives
//! [`RoutineRegistry::tick`]; the schedule parser, the registry and the state
//! machine stay as they are.
//!
//! The cron support in this module is deliberately minimal — `every N
//! seconds|minutes|hours` and `daily at HH:MM` (UTC). Full cron is deferred to
//! the Goose-backed scheduler rather than duplicated here.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

use thiserror::Error;

/// Seconds in a minute.
const SECONDS_PER_MINUTE: u64 = 60;
/// Seconds in an hour.
const SECONDS_PER_HOUR: u64 = 3_600;
/// Seconds in a day.
const SECONDS_PER_DAY: u64 = 86_400;

/// Stable identifier of a routine, unique inside one [`RoutineRegistry`].
pub type RoutineId = String;

/// When a routine comes due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutineSchedule {
    /// A minimal cron expression; see the module docs for the accepted forms.
    Cron(String),
    /// Run every `n` seconds after the previous run (`0` is rejected).
    IntervalSeconds(u64),
    /// Only ever run by an explicit [`RoutineAction::RunNow`].
    Manual,
}

/// Where a routine is in its lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoutineState {
    /// Registered and eligible for scheduling.
    Idle,
    /// Handed out by [`RoutineRegistry::tick`] and not yet completed.
    Running,
    /// Paused by the owner; never due until resumed.
    Paused,
    /// The last run failed; parked until the owner resumes or runs it manually.
    Failed(String),
}

impl RoutineState {
    /// Short label used in errors and in the Simple-mode routines list.
    pub fn label(&self) -> &'static str {
        match self {
            RoutineState::Idle => "idle",
            RoutineState::Running => "running",
            RoutineState::Paused => "paused",
            RoutineState::Failed(_) => "failed",
        }
    }
}

/// An owner action on a registered routine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RoutineAction {
    /// Run once now, regardless of the schedule.
    RunNow,
    /// Stop scheduling the routine.
    Pause,
    /// Allow a paused or failed routine to be scheduled again.
    Resume,
}

/// A scheduled task: what it does is [`Routine::description`], the runner
/// decides the how.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Routine {
    /// Unique identifier.
    pub id: RoutineId,
    /// Owner-facing name shown in Simple mode.
    pub name: String,
    /// Plain-language description of what the routine does.
    pub description: String,
    /// When the routine comes due.
    pub schedule: RoutineSchedule,
    /// Current lifecycle state.
    pub state: RoutineState,
    /// Unix seconds of the last accepted run, if any.
    pub last_run_unix: Option<u64>,
}

impl Routine {
    /// Create an idle routine with an empty description.
    pub fn new(id: &str, name: &str, schedule: RoutineSchedule) -> Self {
        Self {
            id: id.to_string(),
            name: name.to_string(),
            description: String::new(),
            schedule,
            state: RoutineState::Idle,
            last_run_unix: None,
        }
    }

    /// Attach the plain-language description shown in Simple mode.
    pub fn with_description(mut self, description: &str) -> Self {
        self.description = description.to_string();
        self
    }
}

/// Errors raised by the registry and by routine runners.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum RoutineError {
    /// No routine carries that id.
    #[error("routine not found: {0}")]
    NotFound(RoutineId),
    /// A routine with that id is already registered.
    #[error("routine already registered: {0}")]
    Duplicate(RoutineId),
    /// The id is empty or whitespace only.
    #[error("invalid routine id: {0:?}")]
    InvalidId(String),
    /// The schedule expression could not be parsed.
    #[error("invalid routine schedule: {0:?}")]
    InvalidSchedule(String),
    /// The requested action does not fit the current state.
    #[error("cannot {action} routine {routine}: state is {state}")]
    InvalidState {
        /// Routine the action targeted.
        routine: RoutineId,
        /// Action that was refused.
        action: String,
        /// State the routine was in.
        state: String,
    },
    /// A runner reported a failure.
    #[error("routine runner failed: {0}")]
    Runner(String),
}

/// Executes routines. A Goose-backed scheduler is one implementation.
///
/// Only [`RoutineRunner::run`] is required; the default `pause`/`resume` are
/// no-ops for runners that keep no external state.
pub trait RoutineRunner {
    /// Run `routine` once. An `Err` parks the routine in [`RoutineState::Failed`].
    fn run(&self, routine: &Routine) -> Result<(), RoutineError>;

    /// Stop scheduling `routine` outside Warsha, if the runner tracks that.
    fn pause(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }

    /// Allow `routine` to be scheduled again, if the runner tracks that.
    fn resume(&self, _routine: &Routine) -> Result<(), RoutineError> {
        Ok(())
    }
}

/// Test double that records the calls it receives.
#[derive(Debug, Default)]
pub struct MockRoutineRunner {
    runs: RefCell<Vec<RoutineId>>,
    pauses: RefCell<Vec<RoutineId>>,
    resumes: RefCell<Vec<RoutineId>>,
    fail_next_run: Cell<bool>,
}

impl MockRoutineRunner {
    /// An empty runner that succeeds on every call.
    pub fn new() -> Self {
        Self::default()
    }

    /// Make the next [`RoutineRunner::run`] fail with [`RoutineError::Runner`].
    pub fn failing(self) -> Self {
        self.fail_next_run.set(true);
        self
    }

    /// Ids passed to [`RoutineRunner::run`], in call order.
    pub fn run_ids(&self) -> Vec<RoutineId> {
        self.runs.borrow().clone()
    }

    /// Ids passed to [`RoutineRunner::pause`], in call order.
    pub fn pause_ids(&self) -> Vec<RoutineId> {
        self.pauses.borrow().clone()
    }

    /// Ids passed to [`RoutineRunner::resume`], in call order.
    pub fn resume_ids(&self) -> Vec<RoutineId> {
        self.resumes.borrow().clone()
    }
}

impl RoutineRunner for MockRoutineRunner {
    fn run(&self, routine: &Routine) -> Result<(), RoutineError> {
        self.runs.borrow_mut().push(routine.id.clone());
        if self.fail_next_run.get() {
            self.fail_next_run.set(false);
            return Err(RoutineError::Runner(format!(
                "mock failure for {}",
                routine.id
            )));
        }
        Ok(())
    }

    fn pause(&self, routine: &Routine) -> Result<(), RoutineError> {
        self.pauses.borrow_mut().push(routine.id.clone());
        Ok(())
    }

    fn resume(&self, routine: &Routine) -> Result<(), RoutineError> {
        self.resumes.borrow_mut().push(routine.id.clone());
        Ok(())
    }
}

/// The set of registered routines and the due-date arithmetic.
#[derive(Debug, Default)]
pub struct RoutineRegistry {
    routines: HashMap<RoutineId, Routine>,
}

impl RoutineRegistry {
    /// An empty registry.
    pub fn new() -> Self {
        Self::default()
    }

    /// Register a routine, rejecting a bad id, a duplicate and a bad schedule.
    pub fn register(&mut self, routine: Routine) -> Result<RoutineId, RoutineError> {
        if routine.id.trim().is_empty() {
            return Err(RoutineError::InvalidId(routine.id));
        }
        if self.routines.contains_key(&routine.id) {
            return Err(RoutineError::Duplicate(routine.id));
        }
        parse_schedule(&routine.schedule)?;
        let id = routine.id.clone();
        self.routines.insert(id.clone(), routine);
        Ok(id)
    }

    /// Every routine, ordered by id so Simple-mode lists stay stable.
    pub fn list(&self) -> Vec<&Routine> {
        let mut routines: Vec<&Routine> = self.routines.values().collect();
        routines.sort_by(|left, right| left.id.cmp(&right.id));
        routines
    }

    /// The routine with `id`, if registered.
    pub fn get(&self, id: &str) -> Option<&Routine> {
        self.routines.get(id)
    }

    /// Remove and return the routine with `id`.
    pub fn remove(&mut self, id: &str) -> Option<Routine> {
        self.routines.remove(id)
    }

    /// Collect the routines that are due at `now_unix` and mark them
    /// [`RoutineState::Running`], stamping `last_run_unix`.
    ///
    /// Paused, running and failed routines are never due: a failure needs an
    /// explicit [`RoutineAction::Resume`] (or [`RoutineAction::RunNow`]) first.
    pub fn tick(&mut self, now_unix: u64) -> Vec<RoutineId> {
        let mut due = Vec::new();
        for routine in self.routines.values_mut() {
            if routine.state != RoutineState::Idle {
                continue;
            }
            let Ok(schedule) = parse_schedule(&routine.schedule) else {
                continue;
            };
            if !is_due(schedule, routine.last_run_unix, now_unix) {
                continue;
            }
            routine.state = RoutineState::Running;
            routine.last_run_unix = Some(now_unix);
            due.push(routine.id.clone());
        }
        due.sort();
        due
    }

    /// Apply an owner action, calling `runner` for the side effects.
    pub fn apply(
        &mut self,
        id: &str,
        action: RoutineAction,
        now_unix: u64,
        runner: &dyn RoutineRunner,
    ) -> Result<(), RoutineError> {
        let routine = self
            .routines
            .get(id)
            .ok_or_else(|| RoutineError::NotFound(id.to_string()))?
            .clone();

        match action {
            RoutineAction::RunNow => {
                if routine.state == RoutineState::Running {
                    return Err(self.invalid_state(&routine, "run"));
                }
                let mut running = routine;
                running.state = RoutineState::Running;
                running.last_run_unix = Some(now_unix);
                self.routines.insert(running.id.clone(), running.clone());
                match runner.run(&running) {
                    Ok(()) => self.complete(id, None),
                    Err(error) => {
                        self.complete(id, Some(error.to_string()))?;
                        Err(error)
                    }
                }
            }
            RoutineAction::Pause => {
                if !matches!(routine.state, RoutineState::Idle | RoutineState::Failed(_)) {
                    return Err(self.invalid_state(&routine, "pause"));
                }
                runner.pause(&routine)?;
                self.set_state(id, RoutineState::Paused)
            }
            RoutineAction::Resume => {
                if !matches!(
                    routine.state,
                    RoutineState::Paused | RoutineState::Failed(_)
                ) {
                    return Err(self.invalid_state(&routine, "resume"));
                }
                runner.resume(&routine)?;
                self.set_state(id, RoutineState::Idle)
            }
        }
    }

    /// Record the outcome of a routine handed out by [`Self::tick`].
    pub fn complete(&mut self, id: &str, failure: Option<String>) -> Result<(), RoutineError> {
        let state = match failure {
            Some(message) => RoutineState::Failed(message),
            None => RoutineState::Idle,
        };
        self.set_state(id, state)
    }

    fn set_state(&mut self, id: &str, state: RoutineState) -> Result<(), RoutineError> {
        let routine = self
            .routines
            .get_mut(id)
            .ok_or_else(|| RoutineError::NotFound(id.to_string()))?;
        routine.state = state;
        Ok(())
    }

    fn invalid_state(&self, routine: &Routine, action: &str) -> RoutineError {
        RoutineError::InvalidState {
            routine: routine.id.clone(),
            action: action.to_string(),
            state: routine.state.label().to_string(),
        }
    }
}

/// The schedule forms this module understands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ParsedSchedule {
    /// A fixed gap in seconds between runs.
    Interval(u64),
    /// A daily wall-clock time, UTC.
    Daily { hour: u8, minute: u8 },
}

fn invalid_schedule(expression: &str) -> RoutineError {
    RoutineError::InvalidSchedule(expression.to_string())
}

/// Parse a [`RoutineSchedule`] into the schedule forms this module can time.
///
/// [`RoutineSchedule::Manual`] has no parsed form because it is never due.
fn parse_schedule(schedule: &RoutineSchedule) -> Result<Option<ParsedSchedule>, RoutineError> {
    match schedule {
        RoutineSchedule::Manual => Ok(None),
        RoutineSchedule::IntervalSeconds(seconds) => {
            if *seconds == 0 {
                return Err(invalid_schedule("interval 0"));
            }
            Ok(Some(ParsedSchedule::Interval(*seconds)))
        }
        RoutineSchedule::Cron(expression) => parse_cron(expression).map(Some),
    }
}

/// Parse the minimal cron subset: `every N seconds|minutes|hours` and
/// `daily at HH:MM` (UTC). Anything else is rejected — full cron waits for the
/// Goose-backed scheduler.
fn parse_cron(expression: &str) -> Result<ParsedSchedule, RoutineError> {
    let normalized = expression
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();

    if let Some(rest) = normalized.strip_prefix("every ") {
        let mut parts = rest.split(' ');
        let amount = parts.next().ok_or_else(|| invalid_schedule(expression))?;
        let unit = parts.next().ok_or_else(|| invalid_schedule(expression))?;
        if parts.next().is_some() {
            return Err(invalid_schedule(expression));
        }
        let amount: u64 = amount.parse().map_err(|_| invalid_schedule(expression))?;
        if amount == 0 {
            return Err(invalid_schedule(expression));
        }
        let seconds = match unit {
            "second" | "seconds" => amount,
            "minute" | "minutes" => amount.saturating_mul(SECONDS_PER_MINUTE),
            "hour" | "hours" => amount.saturating_mul(SECONDS_PER_HOUR),
            _ => return Err(invalid_schedule(expression)),
        };
        return Ok(ParsedSchedule::Interval(seconds));
    }

    if let Some(rest) = normalized.strip_prefix("daily at ") {
        let (hour, minute) = rest
            .split_once(':')
            .ok_or_else(|| invalid_schedule(expression))?;
        let hour: u8 = hour.parse().map_err(|_| invalid_schedule(expression))?;
        let minute: u8 = minute.parse().map_err(|_| invalid_schedule(expression))?;
        if hour > 23 || minute > 59 {
            return Err(invalid_schedule(expression));
        }
        return Ok(ParsedSchedule::Daily { hour, minute });
    }

    Err(invalid_schedule(expression))
}

/// Whether a parsed schedule is due at `now_unix`.
///
/// A never-run interval routine is due at the first tick it is idle for; a
/// never-run daily routine waits for its wall-clock time (and therefore runs at
/// the first tick at or after that time on the day it is registered).
fn is_due(schedule: Option<ParsedSchedule>, last_run_unix: Option<u64>, now_unix: u64) -> bool {
    let Some(schedule) = schedule else {
        return false;
    };
    match (schedule, last_run_unix) {
        (ParsedSchedule::Interval(_), None) => true,
        (ParsedSchedule::Interval(seconds), Some(last_run)) => {
            last_run.saturating_add(seconds) <= now_unix
        }
        (ParsedSchedule::Daily { hour, minute }, None) => {
            start_of_day_utc(now_unix).saturating_add(daily_offset(hour, minute)) <= now_unix
        }
        (ParsedSchedule::Daily { hour, minute }, Some(last_run)) => {
            next_daily_after(hour, minute, last_run) <= now_unix
        }
    }
}

/// The UTC day of `unix_seconds` starts here.
fn start_of_day_utc(unix_seconds: u64) -> u64 {
    (unix_seconds / SECONDS_PER_DAY) * SECONDS_PER_DAY
}

/// Seconds from midnight to `hour`:`minute`.
fn daily_offset(hour: u8, minute: u8) -> u64 {
    u64::from(hour) * SECONDS_PER_HOUR + u64::from(minute) * SECONDS_PER_MINUTE
}

/// The first UTC wall-clock occurrence of `hour`/`minute` after `after_unix`.
fn next_daily_after(hour: u8, minute: u8, after_unix: u64) -> u64 {
    let today = start_of_day_utc(after_unix).saturating_add(daily_offset(hour, minute));
    if today > after_unix {
        today
    } else {
        today.saturating_add(SECONDS_PER_DAY)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MINUTE: u64 = 60;

    fn registry_with(routines: Vec<Routine>) -> RoutineRegistry {
        let mut registry = RoutineRegistry::new();
        for routine in routines {
            registry.register(routine).unwrap();
        }
        registry
    }

    #[test]
    fn registers_lists_and_removes() {
        let mut registry = registry_with(vec![
            Routine::new(
                "nightly",
                "Nightly",
                RoutineSchedule::Cron("daily at 02:00".into()),
            ),
            Routine::new(
                "heartbeat",
                "Heartbeat",
                RoutineSchedule::IntervalSeconds(300),
            ),
        ]);

        let ids: Vec<&str> = registry.list().iter().map(|r| r.id.as_str()).collect();
        assert_eq!(ids, vec!["heartbeat", "nightly"]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.name.as_str()),
            Some("Heartbeat")
        );

        let removed = registry.remove("nightly").expect("nightly is registered");
        assert_eq!(removed.id, "nightly");
        assert!(registry.get("nightly").is_none());
        assert!(registry.remove("nightly").is_none());
    }

    #[test]
    fn rejects_duplicate_bad_id_and_bad_schedule() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(300),
        )]);

        let duplicate = registry.register(Routine::new(
            "heartbeat",
            "Again",
            RoutineSchedule::IntervalSeconds(60),
        ));
        assert_eq!(duplicate, Err(RoutineError::Duplicate("heartbeat".into())));

        let blank = registry.register(Routine::new("  ", "Blank", RoutineSchedule::Manual));
        assert!(matches!(blank, Err(RoutineError::InvalidId(_))));

        let zero = registry.register(Routine::new(
            "zero",
            "Zero",
            RoutineSchedule::IntervalSeconds(0),
        ));
        assert!(matches!(zero, Err(RoutineError::InvalidSchedule(_))));

        let nonsense = registry.register(Routine::new(
            "weird",
            "Weird",
            RoutineSchedule::Cron("0 2 * * *".into()),
        ));
        assert!(matches!(nonsense, Err(RoutineError::InvalidSchedule(_))));
    }

    #[test]
    fn tick_returns_due_routines_once() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(5 * MINUTE),
        )]);

        assert_eq!(registry.tick(1_000), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Running)
        );

        // Still running: not due again even after the interval elapses.
        assert!(registry.tick(1_000 + 10 * MINUTE).is_empty());

        registry.complete("heartbeat", None).unwrap();
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );
        assert!(registry.tick(1_000 + 4 * MINUTE).is_empty());
        assert_eq!(
            registry.tick(1_000 + 5 * MINUTE),
            vec!["heartbeat".to_string()]
        );
    }

    #[test]
    fn tick_skips_manual_paused_and_failed() {
        let mut registry = registry_with(vec![
            Routine::new("manual", "Manual", RoutineSchedule::Manual),
            Routine::new("paused", "Paused", RoutineSchedule::IntervalSeconds(MINUTE)),
            Routine::new("broken", "Broken", RoutineSchedule::IntervalSeconds(MINUTE)),
        ]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("paused", RoutineAction::Pause, 0, &runner)
            .unwrap();
        registry
            .apply("broken", RoutineAction::RunNow, 0, &runner)
            .unwrap();
        registry.complete("broken", Some("boom".into())).unwrap();

        assert!(registry.tick(10 * MINUTE).is_empty());
        assert_eq!(
            registry.get("paused").map(|r| r.state.clone()),
            Some(RoutineState::Paused)
        );
        assert_eq!(
            registry.get("broken").map(|r| r.state.clone()),
            Some(RoutineState::Failed("boom".into()))
        );
    }

    #[test]
    fn pause_and_resume_drive_the_runner_and_the_state() {
        let mut registry = registry_with(vec![Routine::new(
            "heartbeat",
            "Heartbeat",
            RoutineSchedule::IntervalSeconds(MINUTE),
        )]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("heartbeat", RoutineAction::Pause, 0, &runner)
            .unwrap();
        assert_eq!(runner.pause_ids(), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Paused)
        );

        // Pausing twice is refused rather than silently ignored.
        let twice = registry.apply("heartbeat", RoutineAction::Pause, 0, &runner);
        assert!(matches!(twice, Err(RoutineError::InvalidState { .. })));

        registry
            .apply("heartbeat", RoutineAction::Resume, 0, &runner)
            .unwrap();
        assert_eq!(runner.resume_ids(), vec!["heartbeat".to_string()]);
        assert_eq!(
            registry.get("heartbeat").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );

        // Resuming an idle routine is refused too.
        let again = registry.apply("heartbeat", RoutineAction::Resume, 0, &runner);
        assert!(matches!(again, Err(RoutineError::InvalidState { .. })));
    }

    #[test]
    fn manual_run_ignores_the_schedule_and_records_the_time() {
        let mut registry = registry_with(vec![Routine::new(
            "report",
            "Weekly report",
            RoutineSchedule::Manual,
        )]);
        let runner = MockRoutineRunner::new();

        registry
            .apply("report", RoutineAction::RunNow, 4_242, &runner)
            .unwrap();

        assert_eq!(runner.run_ids(), vec!["report".to_string()]);
        let routine = registry.get("report").expect("report is registered");
        assert_eq!(routine.state, RoutineState::Idle);
        assert_eq!(routine.last_run_unix, Some(4_242));
        assert!(registry.tick(1_000_000).is_empty());
    }

    #[test]
    fn a_failing_runner_parks_the_routine() {
        let mut registry = registry_with(vec![Routine::new(
            "report",
            "Report",
            RoutineSchedule::Manual,
        )]);
        let runner = MockRoutineRunner::new().failing();

        let outcome = registry.apply("report", RoutineAction::RunNow, 10, &runner);
        assert!(matches!(outcome, Err(RoutineError::Runner(_))));
        assert!(matches!(
            registry.get("report").map(|r| r.state.clone()),
            Some(RoutineState::Failed(_))
        ));

        // Resume clears the failure; the routine is schedulable again.
        registry
            .apply("report", RoutineAction::Resume, 20, &runner)
            .unwrap();
        assert_eq!(
            registry.get("report").map(|r| r.state.clone()),
            Some(RoutineState::Idle)
        );
    }

    #[test]
    fn daily_cron_comes_due_once_per_day() {
        let mut registry = registry_with(vec![Routine::new(
            "daily",
            "Daily digest",
            RoutineSchedule::Cron("daily at 09:30".into()),
        )]);

        // 2026-01-01T09:00:00Z — before the wall-clock time.
        let before = 1_767_258_000;
        assert!(registry.tick(before).is_empty());

        // 2026-01-01T09:30:00Z — first run.
        assert_eq!(
            registry.tick(before + 30 * MINUTE),
            vec!["daily".to_string()]
        );
        registry.complete("daily", None).unwrap();

        // Later the same day: no second run.
        assert!(registry.tick(before + 5 * 3_600).is_empty());
        // Next day: due again.
        assert_eq!(
            registry.tick(before + 24 * 3_600 + 30 * MINUTE),
            vec!["daily".to_string()]
        );
    }

    #[test]
    fn cron_parser_accepts_the_documented_forms() {
        assert_eq!(
            parse_cron("every 15 Minutes").unwrap(),
            ParsedSchedule::Interval(900)
        );
        assert_eq!(
            parse_cron("every 2 hours").unwrap(),
            ParsedSchedule::Interval(7_200)
        );
        assert_eq!(
            parse_cron("daily at 23:59").unwrap(),
            ParsedSchedule::Daily {
                hour: 23,
                minute: 59
            }
        );

        for invalid in [
            "every 0 minutes",
            "every 5 decades",
            "daily at 24:00",
            "daily at 9",
            "*/5 * * * *",
        ] {
            assert!(
                matches!(parse_cron(invalid), Err(RoutineError::InvalidSchedule(_))),
                "{invalid} should be rejected"
            );
        }
    }

    #[test]
    fn applying_an_unknown_routine_is_not_found() {
        let mut registry = RoutineRegistry::new();
        let runner = MockRoutineRunner::new();
        let outcome = registry.apply("ghost", RoutineAction::RunNow, 0, &runner);
        assert_eq!(outcome, Err(RoutineError::NotFound("ghost".into())));
    }
}
