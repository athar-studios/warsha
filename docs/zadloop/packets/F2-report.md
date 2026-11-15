# R-UI-4 — Part A: F2 Report

**Status:** STOPPED — capture host.

## 1. Canary Output
The host canary (`bash docker/capture/canary.sh`) failed, reproducing 84 failures, primarily `Content Security Policy` and pixel diffs.
Measured: 0/84 passed (canary output recorded).

## 2. Part A Status
- Part A: **STOPPED — capture host**. The F1 Docker host on this machine failed the canary check (R-UI-4 §3 requirement).
- Part B: **Completed**. Remote harness repair verified (7/7 flows passed).

## 3. Decisions (D-RN-F2-n)
- **D-RN-F2-1**: Due to canary failure, Part A is marked blocked per `R-UI-4.md` §10.3 (Unblock condition).

## 4. Owner Checklist
- [ ] Restore capture host functionality (see U-a/U-b/U-c in `docs/zadloop/packets/R-UI-4.md`).
- [ ] Re-run Part A capture.
