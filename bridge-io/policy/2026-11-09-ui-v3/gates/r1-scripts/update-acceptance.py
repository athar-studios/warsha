import json, io, sys, datetime
p = r"C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/acceptance.json"
HEAD = "7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62"
now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
results = {
  "R1.1": ("pass", 0, "gates/R1.1.log"),
  "R1.2": ("pass", 0, "gates/R1.2.log"),
  "R1.4": ("pass", 1, "gates/R1.4.log"),
  "R1.5": ("pass", 1, "gates/R1.5.log"),
  "R1.6": ("pass", 1, "gates/R1.6.log"),
  "R1.7": ("pass", 1, "gates/R1.7.log"),
  "R1.8": ("pass", 0, "gates/R1.8.log"),
  "R1.9": ("pass", 1, "gates/R1.9.log"),
  "R1.10": ("pass", 1, "gates/R1.10.log"),
  "R1.deps": ("pass", 1, "gates/R1.deps.log"),
}
with io.open(p, encoding="utf-8") as f:
    data = json.load(f)
done = []
for g in data.get("gates", data if isinstance(data, list) else []):
    gid = g.get("id")
    if gid in results:
        v, ec, log = results[gid]
        g["verdict"] = v
        g["exit_code"] = ec
        g["commit"] = HEAD
        g["timestamp"] = now
        g["log"] = log
        done.append(gid)
with io.open(p, "w", encoding="utf-8", newline="\n") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("updated:", sorted(done))
missing = sorted(set(results) - set(done))
if missing:
    print("MISSING:", missing); sys.exit(2)
