/** Covered-breach matrix (refundable): latency_breach, server_error, network_error. */

export type Outcome =
  | "ok"
  | "latency_breach"
  | "server_error"
  | "client_error"
  | "network_error";

export type VerdictSource = "x500_observed" | "client_attested" | "oracle";

export const HEDERA_TESTNET = "hedera:testnet" as const;
export const HBAR_ASSET_ID = "0.0.0" as const;

export interface EndpointConfig {
  slug: string;
  sla_latency_ms: number;
  /** Flat premium per covered call, in tinybars. */
  flat_premium_tinybars: bigint;
  /** Per-call parametric refund principal ceiling, in tinybars. */
  imputed_cost_tinybars: bigint;
}

/**
 * Settlement event published after every wrapped call.
 * bigint money fields are decimal strings for JSON safety.
 */
export interface SettlementEvent {
  callId: string;
  agentAccountId: string;
  endpointSlug: string;
  premiumTinybars: string;
  refundTinybars: string;
  latencyMs: number;
  outcome: Outcome;
  ts: string;
  network: typeof HEDERA_TESTNET;
  asset: typeof HBAR_ASSET_ID;
  verdictSource?: VerdictSource;
}

export function assertHbarAsset(asset: string): void {
  if (asset !== HBAR_ASSET_ID) {
    throw new Error(
      `x500: asset must be HBAR (${HBAR_ASSET_ID}); got ${JSON.stringify(asset)}`,
    );
  }
}

export function assertHederaTestnet(network: string): void {
  if (network !== HEDERA_TESTNET) {
    throw new Error(
      `x500: network must be ${HEDERA_TESTNET}; got ${JSON.stringify(network)}`,
    );
  }
}
