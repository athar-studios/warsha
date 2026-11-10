"""Record F3 gate verdicts in EV/acceptance.json (verdict fields only; new F3 rows created from gates.md)."""
import json
import sys

EV = "C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3"
PATH = EV + "/acceptance.json"

HEAD = "738aba6022c058e17eb81d7258977af653ab67a7"  # reviewed F3 head (packet under verification)

# Only F3.1-F3.6 pass now; F3.7.pw appended later after the capture run.
ROWS = [
    {
        "id": "F3.1", "packet": "F3", "host": "windows",
        "check": "pnpm -r typecheck",
        "expect": "exit 0",
        "verdict": "pass", "exit_code": 0, "commit": HEAD,
        "timestamp": "2026-11-10T04:20:05Z", "log": "gates/F3.1.log",
        "note": "run on the scratch merge b70d772676885a53d269a100942ca951a72529ab (F3 738aba6 onto tip 7894d63); 7/8 workspace projects Done",
    },
    {
        "id": "F3.2", "packet": "F3", "host": "windows",
        "check": "pnpm --filter warsha-desktop lint",
        "expect": "exit 0",
        "verdict": "pass", "exit_code": 0, "commit": HEAD,
        "timestamp": "2026-11-10T04:20:12Z", "log": "gates/F3.2.log",
        "note": "scratch merge b70d772; needs F4's base-defect fix (29b0433) in the tip 7894d63 — verified on the scratch merge per orchestrator brief",
    },
    {
        "id": "F3.3", "packet": "F3", "host": "windows",
        "check": "pnpm --filter warsha-desktop test",
        "expect": "exit 0 (\"Tests N passed\")",
        "verdict": "pass", "exit_code": 0, "commit": HEAD,
        "timestamp": "2026-11-10T04:21:24Z", "log": "gates/F3.3.log",
        "note": "scratch merge b70d772; Test Files 79 passed (79), Tests 590 passed (590), first attempt",
    },
    {
        "id": "F3.4", "packet": "F3", "host": "windows",
        "check": "test -z \"$(git diff --name-only $BASE..HEAD | grep -vE '^(playwright\\.config\\.ts|apps/desktop/e2e/support/global-setup\\.ts)$')\"",
        "expect": "exit 0 (scope)",
        "verdict": "pass", "exit_code": 0, "commit": HEAD,
        "timestamp": "2026-11-10T04:22:00Z", "log": "gates/F3.4.log",
        "note": "BASE=7894d63 HEAD=scratch b70d772676885a53d269a100942ca951a72529ab; changed = playwright.config.ts (root) + apps/desktop/e2e/support/global-setup.ts only; amended scope per gates.md F-1",
    },
    {
        "id": "F3.5", "packet": "F3", "host": "windows",
        "check": "deps gate (standard regex vs $BASE..HEAD)",
        "expect": "exit 1 (no dependency added or bumped)",
        "verdict": "pass", "exit_code": 1, "commit": HEAD,
        "timestamp": "2026-11-10T04:22:01Z", "log": "gates/F3.5.log",
        "note": "BASE=7894d63 HEAD=scratch b70d772; grep no-match (exit 1) as required",
    },
    {
        "id": "F3.6", "packet": "F3", "host": "any",
        "check": "node \"$EV/tools\"/pw-gate.mjs snapshots $BASE HEAD -",
        "expect": "exit 0, snapshot_changes=0",
        "verdict": "pass", "exit_code": 0, "commit": HEAD,
        "timestamp": "2026-11-10T04:22:38Z", "log": "gates/F3.6.log",
        "note": "BASE=7894d63 HEAD=scratch b70d772; snapshot_changes=0 outside=0",
    },
]


def main():
    with open(PATH, encoding="utf-8") as f:
        doc = json.load(f)
    existing = {g["id"] for g in doc["gates"]}
    added = []
    for row in ROWS:
        if row["id"] in existing:
            # verdict-only update of an existing row
            for g in doc["gates"]:
                if g["id"] == row["id"]:
                    for k in ("verdict", "exit_code", "commit", "timestamp", "log", "note"):
                        if k in row:
                            g[k] = row[k]
                    break
        else:
            doc["gates"].append(row)
            added.append(row["id"])
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("added=" + ",".join(added) if added else "added=(none)")
    print("total_gates=%d" % len(doc["gates"]))


if __name__ == "__main__":
    sys.exit(main())
