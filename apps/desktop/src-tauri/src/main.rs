//! Warsha desktop entry point.
//!
//! Everything lives in the library (`warsha_desktop_lib`) so it can be tested and reasoned about
//! as a unit; this binary only picks the mode, suppresses the console window on a release Windows
//! build, and hands control over. `windows_subsystem` is a no-op everywhere else, which is why it
//! is spelled with `cfg_attr` rather than inside a `cfg(windows)` item.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;

fn main() -> anyhow::Result<()> {
    let arguments = std::env::args().skip(1).collect::<Vec<String>>();

    // `--self-check` is the one way to verify the half of this app that needs no window: it starts
    // the daemon as the window would, calls it, and stops it again. See `lib.rs`.
    if arguments.iter().any(|argument| argument == "--self-check") {
        let scratch = arguments
            .iter()
            .position(|argument| argument == "--data-dir")
            .and_then(|position| arguments.get(position + 1))
            .map(PathBuf::from);
        return warsha_desktop_lib::self_check(scratch.as_deref());
    }

    warsha_desktop_lib::run()
}
