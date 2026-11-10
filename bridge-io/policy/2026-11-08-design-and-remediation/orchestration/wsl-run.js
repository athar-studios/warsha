// Orchestrator helper: run a command in the WSL Ubuntu capture host as root.
// Usage: node wsl-run.js <timeoutMs> <arg> [arg...]
// Prints stdout/stderr and the real exit code. Never touches /root/warsha-visual's working tree.
const { execFileSync } = require('child_process');
const timeout = Number(process.argv[2]);
const args = process.argv.slice(3);
try {
  const out = execFileSync('wsl.exe', ['-d', 'Ubuntu', '-u', 'root', '--'].concat(args), {
    encoding: 'utf8',
    timeout,
    maxBuffer: 64 * 1024 * 1024,
  });
  process.stdout.write(out);
  console.log('\n[exit 0]');
} catch (e) {
  if (e.stdout) process.stdout.write(String(e.stdout));
  if (e.stderr) process.stderr.write(String(e.stderr));
  console.log('\n[exit ' + (e.status === undefined ? 'timeout/signal' : e.status) + ']');
  process.exitCode = 0; // report, do not abort the orchestrator
}