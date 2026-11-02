// Expected: the load one real user's desktop actually puts on the daemon.
//
// Assumption, unchanged from the first audit: a connected desktop client issues one
// read RPC roughly every 2 seconds. 5 VUs = 5 such clients, so 2.5 req/s over 30s —
// an order of magnitude inside the 240-burst / 1200-per-minute per-identity ceiling.
// That is the design claim being tested here, so a single limiter refusal is a
// threshold failure, not noise.
//
// `projects.list` reads the local store; it reaches no provider, so no paid call.
import { sleep } from 'k6';
import { rpcCall } from './lib/common.js';

export const options = {
  vus: 5,
  duration: '30s',
  thresholds: {
    // The gate: p95 under 800ms, errors under 1%.
    admitted_latency: ['p(95)<800'],
    error_rate: ['rate<0.01'],
    true_errors: ['count==0'],
    // A working session must never see the limiter.
    limiter_http_429: ['count==0'],
    limiter_method_32004: ['count==0'],
  },
};

export default function () {
  rpcCall('projects.list', [], __ITER);
  sleep(2);
}
