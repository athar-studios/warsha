const fs = require('fs');
const path = require('path');

const dir = 'bridge-io/policy/2026-11-08-design-and-remediation';
const statePath = path.join(dir, 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

state.seq = 62;
state.updated_at = at;
state.post_acceptance = state.post_acceptance || {};
state.post_acceptance.delivery = {
  at,
  tip: '13a3b60',
  merge: {
    style: 'git merge --ff-only run/2026-11-08/integration',
    from: '642ae95',
    to: '282bcd6',
    fast_forward: true,
    tree_clean: true,
  },
  preflight: {
    rust: 'release/preflight-rust.out - fmt 0, clippy -D warnings 0, cargo test --workspace --all-targets 0 (746 passed / 0 failed / 10 ignored, 36 suites)',
    web: 'release/preflight-web.out - pnpm -r build 0, pnpm -r test 0 (ui 181, client 148, crypto 22, i18n 52, remote 221, desktop 464), arch 0 (5 rules), policy 0 (8 checks), wire 0 (9 checks), mdbook test 0, gitleaks 0 (158 commits / 50.25 MB, no leaks)',
  },
  artifacts: {
    nsis: {
      file: 'Warsha_0.2.0_x64-setup.exe',
      bytes: 6881725,
      sha256: '5a6e5034ec1b0dd8e03883eb83a0672a5e98b77a112af5bfc96da82406d1f1a9',
      authenticode: 'NotSigned',
    },
    msi: {
      file: 'Warsha_0.2.0_x64_en-US.msi',
      bytes: 9609216,
      sha256: '0f56ed84460d5c451051a625588c8bd61b2e9bad635d48857392599d52fde0c5',
      authenticode: 'NotSigned',
    },
    apk: {
      file: 'warsha-remote-0.2.0-release.apk',
      bytes: 842981,
      sha256: '6a4681852c53f01294159b1d6a905ddb8b32ab968d68fbefcd50a93eae2700ef',
      package: 'dev.warsha.remote',
      version_name: '0.1.0',
      version_code: 1,
      apksigner: 'Verifies',
      schemes: 'v2 only (v1/v3/v3.1/v4 false)',
      key: 'RSA-4096',
      certificate_sha256: 'ad2708e486a68590db9b1ee54e7dfad547759b20f399c16cc6eaad059ce7f3c3',
    },
    docker: {
      local_tag: 'warsha:0.1.0',
      built_as: 'warsha:acceptance',
      manifest_list: 'sha256:bee73f42a9e7e2705d243597dc7aedca1aae98b0c37374680316e59f6ea33a18',
      bytes_uncompressed: 186949308,
      archive: 'warsha-0.1.0-docker-image.tar.gz',
      archive_bytes: 49864914,
      archive_sha256: 'a2af24008865f2545cbf13e07824a7e4d122a3a4adc783b6dc21affc6bff456c',
      smoke: 'prints warsha 0.1.0',
    },
    sbom: {
      tool: 'cargo-cyclonedx 0.5.9 (pinned, same as .github/workflows/release.yml)',
      format: 'CycloneDX 1.3 XML',
      cli_components: 359,
      daemon_components: 358,
    },
  },
  bundle: {
    path: 'dist/release/v0.2.0/',
    gitignored: true,
    files: [
      'upload/ - six assets + checksums.sha256 (sha256sum -c OK)',
      'RELEASE_NOTES.md',
      'RELEASE_MANIFEST.json',
      'CREATE_DRAFT_RELEASE.md',
    ],
    proposed_tag: 'v0.2.0 - owner must confirm; desktop is 0.2.0 while CLI/daemon/APK are 0.1.0',
  },
  publication: 'none. No tag, no push, no GitHub release, no registry push. `gh release create` would create and push a new tag, which has not been authorised.',
  known_limits: [
    'Windows installers are NotSigned (no Authenticode certificate).',
    'No macOS/Linux desktop bundles were built locally; the tag-driven CI matrix builds them.',
    'The container image was not pushed; the tar.gz is the only copy.',
    'G0 remains a recorded fail by design (pre-run baseline truth).',
  ],
};

state.checkpoints = state.checkpoints || {};
state.checkpoints.release_bundle = {
  at,
  seq: 62,
  commit: '13a3b60',
  checkpoint_file: 'checkpoints/062-release-bundle.json',
  summary:
    'preflight green on the release commit; Windows NSIS+MSI, signed APK, Docker image archive and two CycloneDX SBOMs built and verified; local draft bundle staged under dist/release/v0.2.0/; nothing pushed, tagged or published',
};

const out = JSON.stringify(state, null, 2) + '\n';
fs.writeFileSync(statePath, out);
fs.writeFileSync(path.join(dir, 'checkpoints', '062-release-bundle.json'), out);
console.log('seq', state.seq, 'phase', state.phase, 'at', at, 'bytes', out.length);
