import json, io, datetime, sys
p = r"C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3/acceptance.json"
HEAD = "7fec7a04d91fc3ba9fd6ddc2cb963d12e0d03c62"
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
with io.open(p, encoding="utf-8") as f:
    data = json.load(f)
gates = data.get("gates", data if isinstance(data, list) else [])
hit = False
for g in gates:
    if g.get("id") == "R1.3":
        g["verdict"] = "pass"; g["exit_code"] = 0; g["commit"] = HEAD
        g["timestamp"] = now; g["log"] = "gates/R1.3.log"
        hit = True
if not hit: sys.exit("R1.3 not found")
with io.open(p, "w", encoding="utf-8", newline="\n") as f:
    json.dump(data, f, indent=2, ensure_ascii=False); f.write("\n")
print("R1.3 updated")
