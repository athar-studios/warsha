import json, io, datetime, sys
p = r"C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/acceptance.json"
HEAD = "29b04335582ee7383dd56f87827592db5bd64d5e"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
entries = [
  ("F4.1", "pnpm --filter warsha-desktop lint", "exit 0", "pass", 0, "gates/F4.1.log"),
  ("F4.2", "pnpm --filter warsha-desktop test", 'exit 0 and "Tests N passed" with N >= 590', "fail", 1, "gates/F4.2.log"),
  ("F4.3", 'test -z "$(git diff --name-only $BASE..HEAD | grep -vE \'^apps/desktop/src/harness\.contract\.test\.ts$\')"', "exit 0 (scope)", "pass", 0, "gates/F4.3.log"),
  ("F4.4", "deps gate (standard regex vs $BASE..HEAD)", "exit 1 (no dependency added or bumped)", "pass", 1, "gates/F4.4.log"),
  ("F4.5", 'node "$EV/tools"/pw-gate.mjs snapshots $BASE HEAD -', "exit 0, snapshot_changes=0", "pass", 0, "gates/F4.5.log"),
]
with io.open(p, encoding="utf-8") as f:
    data = json.load(f)
gates = data["gates"]
have = {g["id"] for g in gates}
out = []
for gid, check, expect, verdict, ec, log in entries:
    if gid in have:
        g = next(x for x in gates if x["id"] == gid)
        # never touch check/expect if present
    else:
        g = {"id": gid, "packet": "F4", "host": "windows",
             "check": check, "expect": expect}
        out.append(g)
    g["verdict"] = verdict
    g["exit_code"] = ec
    g["commit"] = HEAD if verdict == "pass" else HEAD
    g["timestamp"] = now
    g["log"] = log
# insert new F4 entries before V1.1 (or append at end)
if out:
    idx = next((i for i, g in enumerate(gates) if g["id"] == "V1.1"), len(gates))
    # place after last existing F*/G* packet entry to keep ordering stable
    idx2 = next((i for i, g in enumerate(gates) if g["id"].startswith("V1.")), len(gates))
    gates[idx2:idx2] = out
with io.open(p, "w", encoding="utf-8", newline="\n") as f:
    json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
print("F4 entries:", [e[0] for e in entries])
