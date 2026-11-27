//! Single-instance advisory lock over the daemon data directory (ENGINE H1).

use fs2::FileExt;
use std::path::{Path, PathBuf};

use crate::{DaemonError, Result};

/// Take the daemon's single-instance lock over `data_dir`.
///
/// The directory is made first: the lock lives in it, so a data directory the owner
/// named in a config file and never created would otherwise fail the start with an
/// I/O error that reads like a refusal to run twice.
///
/// The holder's process id is written into the file, and mirrored into an unlocked
/// `warshad.pid` beside it (see [`LockFile`]), so a second daemon — or the desktop
/// shell that found one already running — can say *which* process has the directory,
/// which is the difference between "restart the app" and a half-hour of hunting a
/// stray `warshad`.
pub(crate) fn acquire_lock(data_dir: &Path) -> Result<LockFile> {
    std::fs::create_dir_all(data_dir)?;
    let lock_path = data_dir.join("warshad.lock");
    let mut lock = LockFile::new(lock_path.clone());
    lock.acquire().map_err(|_error| {
        // The operating system's own reason (`WouldBlock`, almost always) says nothing
        // an owner can act on; who holds the lock does.
        DaemonError::Lock(format!(
            "another warshad holds {lock_path:?} ({}); this daemon will not share a data directory",
            lock_holder(&lock_path)
        ))
    })?;
    Ok(lock)
}

/// Who the lock file says holds the lock, as a hint for an error message.
///
/// The holder mirrors its pid into a `warshad.pid` beside the lock precisely because
/// the lock file itself can be unreadable while held (on Windows the holder opens it
/// for writing without sharing read access), so the mirror is tried first and the
/// lock file is the fallback — a holder that predates the mirror, or a mirror that
/// was cleaned away, still names its pid if the lock file can be read at all.
///
/// A pid in a file is a *hint*: the operating system releases the advisory lock when a
/// process dies, so a stale file can name a process that has been gone for years and a
/// recycled pid can name something that has nothing to do with Warsha. Nothing here acts
/// on it — no signal is sent and no lock is taken over another's — because the safe way
/// to stop a daemon the owner cannot see is to ask them, with the number to look at.
fn lock_holder(path: &Path) -> String {
    let mirror = path.with_extension("pid");
    for candidate in [&mirror, path] {
        if let Ok(text) = std::fs::read_to_string(candidate) {
            let pid = text.split_whitespace().next().unwrap_or_default();
            if !pid.is_empty() {
                return format!("pid {pid}");
            }
        }
    }
    "no pid recorded".to_string()
}

/// The daemon's single-instance lock.
///
/// Two things a restart depends on, both of them deliberate:
///
/// - **The advisory lock, not the file's existence, is what decides.** `fs2`'s
///   exclusive lock is held by the *open file description* (Unix) or the file handle
///   (Windows), so the operating system drops it when the holder exits — cleanly, by
///   panic, or by `kill -9`. A lock that had to be deleted by its holder is a lock that
///   has to be cleaned up by whoever comes after.
/// - **The file is never deleted.** Removing it is the one way a restart can end up with
///   two daemons on one data directory: instance A unlinks the path while instance B
///   still holds a handle to the old inode and instance C creates a new file at the same
///   name, and B and C both lock successfully because they locked different files. The
///   next bind to the RPC port is then a crash, or two databases in one directory.
///   Leaving the file costs one inode and makes every instance contend on the same one.
///
/// The endpoint file (`warshad.endpoint`) is written by the holder after binding its
/// actual OS ports and removed on shutdown/drop. It is separate from the lock file and
/// does not participate in the advisory lock.
pub const ENDPOINT_FILE: &str = "warshad.endpoint";

#[derive(Debug)]
pub(crate) struct LockFile {
    path: PathBuf,
    file: Option<std::fs::File>,
}

impl LockFile {
    fn new(path: PathBuf) -> Self {
        Self { path, file: None }
    }

    /// Take the exclusive lock and record this process as the holder.
    fn acquire(&mut self) -> std::io::Result<()> {
        use std::fs::OpenOptions;
        use std::io::Write;
        // `truncate(false)` is deliberate at *open* time: truncating a file another
        // instance may be holding would be the wrong semantic for a lock. Once this
        // process holds the lock exclusively, overwriting its contents is not.
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&self.path)?;

        // An exclusive advisory lock, without blocking. On Unix this is flock(2), on
        // Windows LockFileEx. A lock another instance holds answers `WouldBlock`, which
        // `acquire_lock` turns into the refusal the desktop shell reads as "there is
        // already a daemon, and it is reachable on the ports we both configured".
        file.try_lock_exclusive()?;

        let pid = std::process::id().to_string();
        file.set_len(0)?;
        (&file).write_all(pid.as_bytes())?;

        // Mirror the pid into an ordinary, unlocked file next to the lock. On Windows
        // the lock file is open by its holder for writing, and a write-only open there
        // does not share read access, so a second instance's read of `warshad.lock`
        // fails with a sharing violation — exactly when the refusal needs a name. The
        // mirror is that name; it decides nothing about the lock itself.
        std::fs::write(self.path.with_extension("pid"), pid.as_bytes())?;

        self.file = Some(file);
        Ok(())
    }
}

impl Drop for LockFile {
    fn drop(&mut self) {
        if let Some(file) = self.file.take() {
            // Release the lock, then let the handle close. The file stays: that is the
            // point of `LockFile`, and the next instance truncates it to its own pid
            // the moment it holds the lock.
            let _ = file.unlock();
            drop(file);
        }
    }
}
