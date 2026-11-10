const fs = require('fs');
const path = require('path');

const dir = 'bridge-io/policy/2026-11-08-design-and-remediation';
const statePath = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

state.seq = 64;
state.updated_at = at;
state.post_acceptance.delivery.publication = {
  at,
  authorised_by: 'owner: "install warsha ... and push to main along with releases"',
  main: {
    fast_forward: '2f042d1 -> 4d76e69',
    pushed_to: 'origin (https://github.com/athar-studios/warsha.git)',
    follow_up: '8525255 docs(release): record the published v0.2.0 release and the installed test',
  },
  tag: { name: 'v0.2.0', commit: '4d76e69d25b428c18f2c8f5d4d5787ed26c64097', pushed: true },
  release: {
    url: 'https://github.com/athar-studios/warsha/releases/tag/v0.2.0',
    published_at: '2026-11-09T02:14:47Z',
    draft: false,
    prerelease: false,
    assets: [
      'Warsha_0.2.0_x64-setup.exe',
      'Warsha_0.2.0_x64_en-US.msi',
      'warsha-remote-0.2.0-release.apk',
      'warsha-0.1.0-docker-image.tar.gz',
      'sbom-cli.cdx.xml',
      'sbom-daemon.cdx.xml',
      'checksums.sha256',
    ],
  },
  local_install: {
    host: 'the owner Windows PC',
    installer: 'Warsha_0.2.0_x64-setup.exe /S',
    install_exit: 0,
    installed_to: '%LOCALAPPDATA%\\Programs\\Warsha',
    installed_self_check: '11 PASS, exit 0',
    gui: 'launched; /health answered {"status":"healthy"} on 127.0.0.1:8765',
    app_data_backup: 'the pre-existing %APPDATA%\\warsha was moved to warsha.bak-2026-11-09T0210Z before the install because it failed the migration check',
  },
};

state.checkpoints.release_published = {
  at,
  seq: 64,
  main: '4d76e69 (then 8525255 for the release record)',
  checkpoint_file: 'checkpoints/064-release-published.json',
  summary:
    'main fast-forwarded and pushed to origin; tag v0.2.0 pushed; GitHub release published with 7 assets; the NSIS package installed on the owner Windows host, installed self-check 11/11, GUI healthy on 8765',
};

const out = JSON.stringify(state, null, 2) + '\n';
fs.writeFileSync(statePath, out);
fs.writeFileSync(path.join(dir, 'checkpoints', '064-release-published.json'), out);
console.log('seq', state.seq, 'at', at);
