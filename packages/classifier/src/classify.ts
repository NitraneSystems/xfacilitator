// @x500/classifier — rails core.
//
// One decision tree, one neutral vocabulary. Consumers (wrap, later monitor)
// map CoreCategory onto their own output vocabulary + economics.

export type CoreCategory =
  | "success"
  | "slow"
  | "client_error"
  | "server_error"
  | "network_error"
  | "other";

export interface HttpOutcomeInput {
  /** HTTP status, or null when no response was received. 0 also means no response. */
  statusCode: number | null;
  /** Observed RTT in milliseconds. */
  latencyMs: number;
  /** SLA latency threshold in ms. A 2xx strictly above this is `slow`. */
  latencyThresholdMs: number;
  /** Explicit network-failure signal (e.g. fetch threw). */
  networkError?: boolean;
}

/**
 * Map an HTTP call outcome to a neutral category. Pure; no side effects.
 *
 * Decision tree (first match wins):
 *   1. no response (networkError | statusCode null/0)  -> network_error
 *   2. 500-599                                          -> server_error
 *   3. 400-499                                          -> client_error
 *   4. 200-299 over threshold                           -> slow
 *   5. 200-299 within threshold                         -> success
 *   6. everything else (1xx, 3xx, >=600)                -> other
 */
export function classifyHttpOutcome(input: HttpOutcomeInput): CoreCategory {
  const { statusCode, latencyMs, latencyThresholdMs, networkError } = input;

  if (networkError || statusCode == null || statusCode === 0) {
    return "network_error";
  }
  if (statusCode >= 500 && statusCode <= 599) {
    return "server_error";
  }
  if (statusCode >= 400 && statusCode <= 499) {
    return "client_error";
  }
  if (statusCode >= 200 && statusCode <= 299) {
    return latencyMs > latencyThresholdMs ? "slow" : "success";
  }
  return "other";
}
