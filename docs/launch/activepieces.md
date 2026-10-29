# Activepieces (Optional Automations)

Warsha can hand its "when X happens, do Y" work to **Activepieces Community Edition** instead of growing a
workflow engine of its own. The integration is optional, off by default, and limited to the **MIT-licensed
Community Edition core**.

Owner decision and reasoning: `DECISIONS.md` (2026-10-28, "Automations via Activepieces
CE, never n8n").

## The One Rule: MIT Core Only

The Activepieces repository mixes the MIT core with an enterprise tier. Warsha uses:

* the CE server image, or a checkout limited to the MIT core, and
* the CE flow/connection APIs.

Warsha **never** uses, copies, imports, vendors or builds anything under `packages/ee`. In a local checkout,
that means excluding the directory (`sparse-checkout` or the Docker image), and in review, any diff that
touches `packages/ee` is rejected outright.

| Everything under | License | Used by Warsha |
|---|---|---|
| Activepieces repository root and CE packages (`server`, `web`, `packages/pieces/**` outside `ee`) | MIT | Yes, optionally |
| `packages/ee/**` (enterprise) | Commercial, separate license | **No — never** |

### Why not n8n

n8n's Sustainable Use License forbids end users from building and running workflows on top of it for
commercial purposes, which is precisely what Warsha would ask its owners to do. It is excluded by design;
see `DECISIONS.md`.

## What the Integration Gives Warsha

Automations stay outside the pipeline's gates. A pipeline run still ends at Gate C / Gate D with a human
approval; Activepieces only reacts to events that are already final:

| Trigger from Warsha | Example automation |
|---|---|
| Run completed | Post the run summary into a team chat channel |
| Gate approved or rejected | Open a task in a project tracker, with the gate decision attached |
| Release draft created | Notify the owner's mailing list draft folder |
| Weekly routine finished | Compile the digest mail the owner reviews before sending |

Nothing in this list publishes anything. Sends, posts and payments stay behind Gate D and the owner's
approval card (see `docs/src/gates.md`).

## How to Enable

1. **Settings → Automations → Activepieces** (off by default). Enabling it never installs anything silently.
2. Point Warsha at an Activepieces CE base URL:
   * a CE instance the owner already runs, or
   * a local CE container Warsha may spawn — the owner confirms the image tag first.
3. Warsha shows the **image tag / commit and its MIT license line** in the same dialog and requires an
   explicit confirmation before the first connection.
4. Confirm the license notice is present in `THIRD_PARTY_NOTICES.md`; if the
   deployment uses a different pin than the one recorded there, update that file in the same change.
5. Warsha stores the CE API key in the OS keychain — never in `config.toml`, never in logs.
6. The owner picks which of the events above may leave the machine. Each one is a separate toggle, and the
   payload preview is shown before the toggle can be saved.

Disabling the integration removes the connection and the stored key. It never deletes flows the owner built
in their own CE instance.

## License Recording

Every declared third-party component is listed in `THIRD_PARTY_NOTICES.md` with
its license and a link to the upstream license text — not a copy of the text. When Activepieces is enabled
on a machine, the pin (image tag or commit) is recorded next to that row, so a release always has an auditable
license trail.

## Failure Modes and Boundaries

* **CE unreachable** — automations queue locally and retry; the pipeline is never blocked by an automation.
* **CE returns an error** — logged as an automation failure event, shown in Advanced mode. No retry storm.
* **EE present in a checkout** — Warsha refuses to connect and says why.
* **Automation wants to publish** — it cannot. It creates a Gate D draft at most.

## Status

| Item | State |
|---|---|
| License review and `THIRD_PARTY_NOTICES.md` entry | Done (M16) |
| Decision recorded in `DECISIONS.md` | Done |
| Settings toggle and CE connection | Not implemented yet |
| Deployment target (bundled container vs. user-hosted CE) | Human-only decision, recorded in `PROGRESS.md` |
