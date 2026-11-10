const fs = require('fs');
const path = require('path');

const dir = 'bridge-io/policy/2026-11-08-design-and-remediation';
const statePath = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

state.seq = 63;
state.updated_at = at;
state.post_acceptance.delivery.verification = {
  desktop_selfcheck: {
    at,
    command: 'warsha-desktop.exe --self-check --data-dir <fresh temp dir>',
    exit: 0,
    result: '11 PASS; daemon start/stop, bearer auth, CORS preflight, /health, projects.create, runs.start, gates.approve, runs.advance to Gate B on the zero-key FakeProvider, single-writer lock exclusivity',
    log: 'release/desktop-selfcheck.log',
    stale_data_dir: 'a pre-existing old %APPDATA%\\warsha directory failed the migration check ("migration 1 was previously applied but has been modified"); reported by the build verification, not reproduced against the owner data dir',
  },
};

state.checkpoints.desktop_selfcheck = {
  at,
  seq: 63,
  commit: '13a3b60',
  checkpoint_file: 'checkpoints/063-desktop-selfcheck.json',
  summary:
    'the built desktop binary self-check passes 11/11 on a fresh data dir (release/desktop-selfcheck.log); the upgrade caveat from an old %APPDATA% data dir is recorded',
};

const out = JSON.stringify(state, null, 2) + '\n';
fs.writeFileSync(statePath, out);
fs.writeFileSync(path.join(dir, 'checkpoints', '063-desktop-selfcheck.json'), out);
console.log('seq', state.seq, 'at', at);
