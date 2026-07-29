import type { Outcome } from "./types.js";

export const HEADERS = {
  PREMIUM: "X-X500-Premium",
  REFUND: "X-X500-Refund",
  LATENCY_MS: "X-X500-Latency-Ms",
  OUTCOME: "X-X500-Outcome",
  POOL: "X-X500-Pool",
  SETTLEMENT_PENDING: "X-X500-Settlement-Pending",
  CALL_ID: "X-X500-Call-Id",
  ASSET: "X-X500-Asset",
  NETWORK: "X-X500-Network",
} as const;

export interface X500HeaderInputs {
  callId: string;
  outcome: Outcome;
  premiumTinybars: bigint;
  refundTinybars: bigint;
  latencyMs: number;
  pool?: string;
  settlementPending?: boolean;
  asset?: string;
  network?: string;
}

/** Returns a NEW Response with X-X500-* headers. Does not mutate the original. */
export function attachX500Headers(
  response: Response,
  inputs: X500HeaderInputs,
): Response {
  const headers = new Headers(response.headers);
  headers.set(HEADERS.PREMIUM, inputs.premiumTinybars.toString());
  headers.set(HEADERS.REFUND, inputs.refundTinybars.toString());
  headers.set(HEADERS.LATENCY_MS, inputs.latencyMs.toString());
  headers.set(HEADERS.OUTCOME, inputs.outcome);
  headers.set(HEADERS.CALL_ID, inputs.callId);
  if (inputs.pool !== undefined) {
    headers.set(HEADERS.POOL, inputs.pool);
  }
  if (inputs.settlementPending) {
    headers.set(HEADERS.SETTLEMENT_PENDING, "1");
  }
  if (inputs.asset !== undefined) {
    headers.set(HEADERS.ASSET, inputs.asset);
  }
  if (inputs.network !== undefined) {
    headers.set(HEADERS.NETWORK, inputs.network);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
