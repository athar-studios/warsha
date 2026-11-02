// Shared plumbing for the Warsha load scenarios.
//
// Only read-only RPC methods are used (`health`, `projects.list`); neither reaches a
// provider, so a run costs no money. Responses are classified into three buckets
// because the daemon refuses a flood in two different shapes:
//
//   - the transport ceiling answers HTTP 429 (+ Retry-After) from the middleware;
//   - the method ceiling answers JSON-RPC -32004 inside an HTTP 200.
//
// k6 counts an HTTP 200 as a success no matter what its body says, so limiter
// rejections of the second kind would be invisible without this classification.

import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

export const RPC_URL = `http://127.0.0.1:${__ENV.WARSHA_RPC_PORT || 8766}`;
export const HTTP_URL = `http://127.0.0.1:${__ENV.WARSHA_HTTP_PORT || 8765}`;

/** Latency of requests the daemon actually served. */
export const admittedLatency = new Trend('admitted_latency', true);
/** Latency of requests the daemon refused with a limiter. */
export const limitedLatency = new Trend('limited_latency', true);

export const okResponses = new Counter('ok_responses');
/** JSON-RPC -32004 refusals (method ceiling). */
export const limiterMethod = new Counter('limiter_method_32004');
/** HTTP 429 refusals (transport ceiling). */
export const limiterTransport = new Counter('limiter_http_429');
/** Anything that is a real failure: connect errors, 4xx other than 429, 5xx, other JSON-RPC errors. */
export const trueErrors = new Counter('true_errors');
/** The share the gates are judged on: real failures over every attempt, limiter refusals excluded. */
export const errorRate = new Rate('error_rate');

const HEADERS = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${__ENV.WARSHA_TOKEN || ''}`,
};

/**
 * One JSON-RPC call, classified into the counters above.
 *
 * @param {string} method RPC method name, read-only
 * @param {Array} params RPC params
 * @param {number} id per-iteration id, only to make a body unique
 * @returns {'ok'|'limited'|'error'} the bucket this response landed in
 */
export function rpcCall(method, params, id) {
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params });
  const res = http.post(RPC_URL, body, { headers: HEADERS });
  return record(bucketOf(res), res);
}

function bucketOf(res) {
  if (res.error) return 'error';
  if (res.status === 429) return 'limiter-transport';
  if (res.status !== 200) return 'error';

  // HTTP 200 still carries JSON-RPC errors; -32004 is the daemon's rate-limit code.
  let parsed;
  try {
    parsed = res.json();
  } catch (e) {
    return 'error';
  }
  if (parsed && parsed.error) {
    return parsed.error.code === -32004 ? 'limiter-method' : 'error';
  }
  if (parsed && parsed.result === undefined) return 'error';
  return 'ok';
}

/** GET /health on the HTTP listener: no credential, bounded per peer. */
export function httpHealth() {
  const res = http.get(`${HTTP_URL}/health`);
  const bucket = res.error ? 'error' : res.status === 429 ? 'limiter-transport' : res.status === 200 ? 'ok' : 'error';
  return record(bucket, res);
}

/** One place where a bucket becomes metrics, so no counter can drift from the rate. */
function record(bucket, res) {
  // `res.http_req_duration` is not a field k6 exposes to VU code; the same number
  // lives in `res.timings.duration`, in milliseconds.
  const ms = res.timings ? res.timings.duration : 0;
  switch (bucket) {
    case 'ok':
      okResponses.add(1);
      admittedLatency.add(ms);
      errorRate.add(false);
      return 'ok';
    case 'limiter-method':
      limiterMethod.add(1);
      limitedLatency.add(ms);
      errorRate.add(false);
      return 'limited';
    case 'limiter-transport':
      limiterTransport.add(1);
      limitedLatency.add(ms);
      errorRate.add(false);
      return 'limited';
    default:
      trueErrors.add(1);
      errorRate.add(true);
      return 'error';
  }
}
