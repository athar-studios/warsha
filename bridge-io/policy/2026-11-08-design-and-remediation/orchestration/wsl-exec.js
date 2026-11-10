// Orchestrator helper v2: run a command in the WSL Ubuntu capture host as root WITHOUT the default
// shell (wsl.exe --exec), so `$VAR`, `$!`, quotes and globs reach the inner program untouched.
// Usage: node wsl-exec.js <timeoutMs> <program> [args...]
// Prints stdout/stderr and the real exit code. Never touches /root/warsha-visual's working tree.
const { spawnSync } = require('child_process');
const timeout = Number(process.argv[2]);
const args = process.argv.slice(3);
const r = spawnSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--exec'].concat(args), {
  encoding: 'utf8',
  timeout,
  maxBuffer: 64 * 1024 * 1024,
});
if (r.stdout) process.stdout.write(r.stdout);
if (r.stderr) process.stderr.write(r.stderr);
console.log('\n[exit ' + (r.status === null ? 'timeout/signal ' + r.signal : r.status) + ']');