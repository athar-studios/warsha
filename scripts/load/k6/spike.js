// Spike: 5x the expected client count, unpaced, to see the limiter do its job.
//
// 25 VUs fire `projects.list` as fast as they can for 30s. That is an order of
// magnitude past the per-identity ceiling, so refusals are the expected outcome and
// are NOT gated here — they are reported as limiter behaviour, separately from the
// latency of what the daemon served.
//
// What this run is judged on is what a flood must never cause: a connection failure,
// a 5xx, a hang, or the daemon dying. Those are `true_errors`, and they must stay 0.
import { rpcCall } from './lib/common.js';

export const options = {
  vus: 25,
  duration: '30s',
  thresholds: {
    true_errors: ['count==0'],
    error_rate: ['rate<0.01'],
    // Proof the daemon kept serving rather than wedging under the flood.
    ok_responses: ['count>0'],
  },
};

export default function () {
  rpcCall('projects.list', [], __ITER);
}
