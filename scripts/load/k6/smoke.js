// Smoke: is the daemon there, and what does one client pay per read?
//
// 1 VU for 10s, paced at one `health` RPC every 100ms (10 req/s). The pacing is the
// point: the daemon's per-identity ceilings are 240 burst then 1200/min, so an
// unpaced loop exhausts them in a fraction of a second and measures the limiter
// rather than the request path. At 10 req/s a 10s run stays inside one burst and the
// latency percentiles describe the served path.
import { sleep } from 'k6';
import { rpcCall } from './lib/common.js';

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: {
    // Nothing here may fail outright.
    true_errors: ['count==0'],
    error_rate: ['rate<0.01'],
    ok_responses: ['count>=80'],
    // Smoke is a reachability check, so it carries no latency gate.
    admitted_latency: ['p(95)<800'],
  },
};

export default function () {
  rpcCall('health', [], __ITER);
  sleep(0.1);
}
