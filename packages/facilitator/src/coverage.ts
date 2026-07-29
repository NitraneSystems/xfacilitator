import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { insertSettleJob, type SettleJobsClient } from "@x500/db";
import {
  computeEconomics,
  type Outcome,
} from "@x500/wrap";
import {
  assertHbarExactRequirements,
  HBAR_ASSET,
  HEDERA_TESTNET,
} from "./hbar.js";

const AGENT_HEADER = "x-x500-agent-account-id";
const BETA_HEADER = "x-x500-beta-key";

export interface CoverageRegisterBody {
  agentAccountId: string;
  outcome: Outcome;
  latencyMs: number;
  /** Required verified Exact settle tx id */
  settlementTxId: string;
  asset: string;
  network: string;
  amountPaidTinybars?: string;
  payTo?: string;
}

function createSb(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as never },
  });
}

function payDefaultEconomics() {
  return {
    flatPremiumTinybars: BigInt(
      process.env.PAY_DEFAULT_FLAT_PREMIUM_TINYBARS ?? "1000000",
    ),
    imputedCostTinybars: BigInt(
      process.env.PAY_DEFAULT_IMPUTED_COST_TINYBARS ?? "10000000",
    ),
    slaLatencyMs: Number(process.env.PAY_DEFAULT_SLA_MS ?? 2000),
  };
}

export async function wellKnownPayCoverage(c: Context) {
  const econ = payDefaultEconomics();
  const feePayer = process.env.X500_FACILITATOR_ACCOUNT_ID?.trim() ?? null;
  return c.json({
    cacheTtlSec: 3600,
    service: "x500-facilitator",
    model: "side-call",
    supportedSchemes: ["x402"],
    network: HEDERA_TESTNET,
    asset: HBAR_ASSET,
    feePayer,
    pools: [
      {
        slug: "pay-default",
        description: "Shared HBAR coverage pool for verified x402 Exact payments",
        asset: HBAR_ASSET,
        network: HEDERA_TESTNET,
        flatPremiumTinybars: econ.flatPremiumTinybars.toString(),
        imputedCostTinybars: econ.imputedCostTinybars.toString(),
        slaLatencyMs: econ.slaLatencyMs,
      },
    ],
  });
}

export async function registerCoverage(
  c: Context,
  opts?: { supabase?: SettleJobsClient },
) {
  const beta = process.env.FACILITATOR_BETA_KEY?.trim();
  if (beta) {
    const provided = c.req.header(BETA_HEADER)?.trim();
    if (provided !== beta) {
      return c.json({ ok: false, error: "invalid_beta_key" }, 401);
    }
  }

  const body = (await c.req.json()) as CoverageRegisterBody;
  const headerAgent = c.req.header(AGENT_HEADER)?.trim();
  if (!headerAgent || headerAgent !== body.agentAccountId) {
    return c.json(
      { ok: false, error: "agent_header_mismatch", expectedHeader: AGENT_HEADER },
      401,
    );
  }

  try {
    assertHbarExactRequirements({
      asset: body.asset,
      network: body.network,
    });
  } catch (err) {
    return c.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      400,
    );
  }

  if (!body.settlementTxId?.trim()) {
    return c.json(
      {
        ok: false,
        error: "verified_payment_required",
        message:
          "settlementTxId from Exact HBAR settle is required; unverified coverage is not accepted",
      },
      400,
    );
  }

  const outcomes: Outcome[] = [
    "ok",
    "latency_breach",
    "server_error",
    "client_error",
    "network_error",
  ];
  if (!outcomes.includes(body.outcome)) {
    return c.json({ ok: false, error: "invalid_outcome" }, 400);
  }

  const econ = payDefaultEconomics();
  const amountPaid =
    body.amountPaidTinybars !== undefined
      ? BigInt(body.amountPaidTinybars)
      : undefined;
  const computed = computeEconomics({
    outcome: body.outcome,
    pool: {
      flatPremiumTinybars: econ.flatPremiumTinybars,
      imputedCostTinybars: econ.imputedCostTinybars,
    },
    amountPaid,
  });

  const callId = randomUUID();
  const payload = {
    callId,
    agentAccountId: body.agentAccountId,
    endpointSlug: "pay-default",
    premiumTinybars: computed.premiumTinybars.toString(),
    refundTinybars: computed.refundTinybars.toString(),
    latencyMs: Number(body.latencyMs ?? 0),
    outcome: body.outcome,
    ts: new Date().toISOString(),
    network: HEDERA_TESTNET,
    asset: HBAR_ASSET,
    verdictSource: "client_attested" as const,
    x402SettlementTxId: body.settlementTxId,
    payTo: body.payTo ?? null,
  };

  const client =
    opts?.supabase ?? (createSb() as unknown as SettleJobsClient);
  await insertSettleJob(client, { callId, payload });

  return c.json({
    ok: true,
    coverageId: callId,
    callId,
    status: "settlement_pending",
    endpointSlug: "pay-default",
    premiumTinybars: computed.premiumTinybars.toString(),
    refundTinybars: computed.refundTinybars.toString(),
    asset: HBAR_ASSET,
    network: HEDERA_TESTNET,
  });
}

export async function getCoverage(c: Context) {
  const id = c.req.param("id");
  if (!id) {
    return c.json({ ok: false, error: "missing_id" }, 400);
  }
  const indexerUrl = (
    process.env.INDEXER_URL ?? "http://127.0.0.1:8787"
  ).replace(/\/$/, "");
  const res = await fetch(`${indexerUrl}/api/calls/${encodeURIComponent(id)}`);
  const body = (await res.json()) as {
    call?: {
      call_id?: string;
      settlement_tx_id?: string | null;
      status?: string;
      refund_tinybars?: number;
      premium_tinybars?: number;
    };
  };
  if (!body.call) {
    // Still pending — check settle_jobs
    const sb = createSb();
    const { data: job } = await sb
      .from("settle_jobs")
      .select("status,call_id,last_error")
      .eq("call_id", id)
      .maybeSingle();
    if (!job) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }
    return c.json({
      ok: true,
      coverageId: id,
      callId: id,
      status:
        job.status === "done"
          ? "settled"
          : job.status === "failed"
            ? "failed"
            : "settlement_pending",
      lastError: job.last_error,
    });
  }
  return c.json({
    ok: true,
    coverageId: body.call.call_id,
    callId: body.call.call_id,
    status: body.call.settlement_tx_id ? "settled" : "settlement_pending",
    settlementTxId: body.call.settlement_tx_id ?? null,
    premiumTinybars: String(body.call.premium_tinybars ?? 0),
    refundTinybars: String(body.call.refund_tinybars ?? 0),
  });
}
