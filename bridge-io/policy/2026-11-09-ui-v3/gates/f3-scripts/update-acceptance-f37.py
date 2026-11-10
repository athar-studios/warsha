"""Record the F3.7.pw verdict in EV/acceptance.json after the capture run (verdict fields only)."""
import json
import sys

EV = "C:/Users/Dragonfly/Downloads/Warsha/bridge-io/policy/2026-11-09-ui-v3"
PATH = EV + "/acceptance.json"

HEAD = "738aba6022c058e17eb81d7258977af653ab67a7"  # reviewed F3 head


def main(pwgate_exit: int, timestamp: str, note: str, scratch_head: str):
    with open(PATH, encoding="utf-8") as f:
        doc = json.load(f)
    row = {
        "id": "F3.7.pw",
        "packet": "F3",
        "host": "capture",
        "check": "pnpm exec playwright test --project=desktop --project=remote --reporter=json > \"$EV/gates/$GATE.json\"; node \"$EV/tools\"/pw-gate.mjs failures \"$EV/gates/$GATE.json\" \"$EV/named/EMPTY.txt\"",
        "expect": "pw-gate exit 0 (0 failures; retries stay 0 — no test, threshold, named-set or gate change)",
        "verdict": "pass" if pwgate_exit == 0 else "fail",
        "exit_code": pwgate_exit,
        "commit": HEAD,
        "timestamp": timestamp,
        "log": "gates/F3.7.pw-gate.log",
        "note": note + f"; capture scratch merge head {scratch_head} (F3 738aba6 onto tip 7894d63) in /root/warsha-f3v",
    }
    for i, g in enumerate(doc["gates"]):
        if g["id"] == "F3.7.pw":
            doc["gates"][i] = row
            break
    else:
        doc["gates"].append(row)
    with open(PATH, "w", encoding="utf-8", newline="\n") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("recorded F3.7.pw verdict=" + row["verdict"] + " exit=" + str(pwgate_exit))


if __name__ == "__main__":
    main(int(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4])
