import { attachX500Headers } from "./headers.js";
import type { BalanceCheck, BalanceCheckResult } from "./balanceCheck.js";
import type { Classifier } from "./classifier.js";
import type { EventSink } from "./eventSink.js";
import {
  assertHbarAsset,
  assertHederaTestnet,
  HBAR_ASSET_ID,
  HEDERA_TESTNET,
  type EndpointConfig,
  type Outcome,
  type SettlementEvent,
} from "./types.js";

export interface WrapFetchOptions {
  endpointSlug: string;
  agentAccountId: string;
  upstreamUrl: string;
  init?: RequestInit;
  classifier: Classifier;
  sink: EventSink;
  balanceCheck?: BalanceCheck;
  endpointConfig: EndpointConfig;
  fetchImpl?: typeof fetch;
  now?: () => number;
  callId?: string;
  pool?: string;
  /** Must be hedera:testnet. */
  network?: string;
  /** Must be 0.0.0 (HBAR). */
  asset?: string;
  /**
   * When true, await sink.publish before returning (e2e durability).
   * Default false = fire-and-forget with logged failures at the sink wrapper.
   */
  awaitSink?: boolean;
}

export interface WrapFetchResult {
  response: Response;
  outcome: Outcome;
  premiumTinybars: bigint;
  refundTinybars: bigint;
  latencyMs: number;
  callId: string;
}

export async function wrapFetch(opts: WrapFetchOptions): Promise<WrapFetchResult> {
  const network = opts.network ?? HEDERA_TESTNET;
  const asset = opts.asset ?? HBAR_ASSET_ID;
  assertHederaTestnet(network);
  assertHbarAsset(asset);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const now = opts.now ?? Date.now;
  const callId = opts.callId ?? generateCallId();

  if (opts.balanceCheck) {
    const required = opts.endpointConfig.flat_premium_tinybars;
    let balance: BalanceCheckResult;
    try {
      balance = await opts.balanceCheck.check(opts.agentAccountId, required);
    } catch (err) {
      const body = JSON.stringify({
        error: "balance_check_failed",
        message: err instanceof Error ? err.message : String(err),
        callId,
      });
      const resp = attachX500Headers(
        new Response(body, {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
        {
          callId,
          outcome: "server_error",
          premiumTinybars: 0n,
          refundTinybars: 0n,
          latencyMs: 0,
          pool: opts.pool,
          asset,
          network,
        },
      );
      return {
        response: resp,
        outcome: "server_error",
        premiumTinybars: 0n,
        refundTinybars: 0n,
        latencyMs: 0,
        callId,
      };
    }

    if (!balance.eligible) {
      const body = JSON.stringify({
        error: "payment_required",
        reason: balance.reason,
        callId,
        hbarTinybars: balance.hbarTinybars?.toString(),
        requiredTinybars: required.toString(),
      });
      const resp = attachX500Headers(
        new Response(body, {
          status: 402,
          headers: { "content-type": "application/json" },
        }),
        {
          callId,
          outcome: "client_error",
          premiumTinybars: 0n,
          refundTinybars: 0n,
          latencyMs: 0,
          pool: opts.pool,
          asset,
          network,
        },
      );
      return {
        response: resp,
        outcome: "client_error",
        premiumTinybars: 0n,
        refundTinybars: 0n,
        latencyMs: 0,
        callId,
      };
    }
  }

  const tStart = now();
  let upstreamResponse: Response | null = null;
  try {
    upstreamResponse = await fetchImpl(opts.upstreamUrl, opts.init);
  } catch {
    upstreamResponse = null;
  }
  const tEnd = now();
  const latencyMs = Math.max(0, tEnd - tStart);

  const classified = opts.classifier.classify({
    response: upstreamResponse,
    latencyMs,
    endpointConfig: {
      sla_latency_ms: opts.endpointConfig.sla_latency_ms,
      flat_premium_tinybars: opts.endpointConfig.flat_premium_tinybars,
      imputed_cost_tinybars: opts.endpointConfig.imputed_cost_tinybars,
    },
  });

  const event: SettlementEvent = {
    callId,
    agentAccountId: opts.agentAccountId,
    endpointSlug: opts.endpointSlug,
    premiumTinybars: classified.premium.toString(),
    refundTinybars: classified.refund.toString(),
    latencyMs,
    outcome: classified.outcome,
    ts: new Date(tEnd).toISOString(),
    network: HEDERA_TESTNET,
    asset: HBAR_ASSET_ID,
    verdictSource: "x500_observed",
  };
  try {
    if (opts.awaitSink) {
      await opts.sink.publish(event);
    } else {
      void Promise.resolve(opts.sink.publish(event)).catch((err) => {
        console.error(
          "[wrapFetch] sink.publish failed",
          err instanceof Error ? err.message : err,
        );
      });
    }
  } catch (err) {
    if (opts.awaitSink) throw err;
    console.error(
      "[wrapFetch] sink.publish threw",
      err instanceof Error ? err.message : err,
    );
  }

  const baseResponse =
    upstreamResponse ??
    new Response(
      JSON.stringify({
        error: "upstream_unreachable",
        callId,
      }),
      { status: 502, headers: { "content-type": "application/json" } },
    );

  const response = attachX500Headers(baseResponse, {
    callId,
    outcome: classified.outcome,
    premiumTinybars: classified.premium,
    refundTinybars: classified.refund,
    latencyMs,
    pool: opts.pool,
    settlementPending: true,
    asset,
    network,
  });

  return {
    response,
    outcome: classified.outcome,
    premiumTinybars: classified.premium,
    refundTinybars: classified.refund,
    latencyMs,
    callId,
  };
}

function generateCallId(): string {
  const c = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (c && typeof c.randomUUID === "function") {
    return c.randomUUID();
  }
  const hex = (n: number) =>
    Math.floor(Math.random() * 0xffffffff)
      .toString(16)
      .padStart(8, "0")
      .slice(0, n);
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${hex(4)}-${hex(8)}${hex(4)}`;
}
