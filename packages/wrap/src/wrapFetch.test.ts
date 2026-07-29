import { describe, expect, it } from "vitest";
import { defaultClassifier } from "./classifier.js";
import { computeEconomics, isCoveredBreach } from "./economics.js";
import { MemoryEventSink, SupabaseEventSink } from "./eventSink.js";
import { assertHbarAsset } from "./types.js";
import { wrapFetch } from "./wrapFetch.js";

const endpointConfig = {
  slug: "dummy",
  sla_latency_ms: 100,
  flat_premium_tinybars: 1_000_000n, // 0.01 HBAR
  imputed_cost_tinybars: 10_000_000n, // 0.1 HBAR
};

describe("computeEconomics", () => {
  it("charges flat premium on ok with zero refund", () => {
    const e = computeEconomics({
      outcome: "ok",
      pool: {
        flatPremiumTinybars: 1n,
        imputedCostTinybars: 10n,
      },
    });
    expect(e.premiumTinybars).toBe(1n);
    expect(e.refundTinybars).toBe(0n);
    expect(e.covered).toBe(true);
  });

  it("refunds principal+premium on covered breach", () => {
    expect(isCoveredBreach("server_error")).toBe(true);
    const e = computeEconomics({
      outcome: "server_error",
      pool: {
        flatPremiumTinybars: 1n,
        imputedCostTinybars: 10n,
      },
    });
    expect(e.refundTinybars).toBe(11n);
  });

  it("zero on client_error", () => {
    const e = computeEconomics({
      outcome: "client_error",
      pool: {
        flatPremiumTinybars: 1n,
        imputedCostTinybars: 10n,
      },
    });
    expect(e.premiumTinybars).toBe(0n);
    expect(e.refundTinybars).toBe(0n);
    expect(e.covered).toBe(false);
  });
});

describe("assertHbarAsset", () => {
  it("rejects non-HBAR asset", () => {
    expect(() => assertHbarAsset("0.0.429274")).toThrow(/HBAR/);
  });
});

describe("SupabaseEventSink", () => {
  it("requires client or env credentials", () => {
    const prevUrl = process.env.SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      expect(() => new SupabaseEventSink()).toThrow(/SUPABASE_URL/);
    } finally {
      if (prevUrl !== undefined) process.env.SUPABASE_URL = prevUrl;
      if (prevKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
    }
  });

  it("inserts settle_jobs via client", async () => {
    const inserts: Record<string, unknown>[] = [];
    const sink = new SupabaseEventSink({
      client: {
        from: () => ({
          insert: async (row: Record<string, unknown>) => {
            inserts.push(row);
            return { error: null };
          },
          update: () => ({
            eq: async () => ({ error: null }),
          }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        rpc: async () => ({ data: [], error: null }),
      },
    });
    await sink.publish({
      callId: "call-1",
      agentAccountId: "0.0.1",
      endpointSlug: "dummy",
      premiumTinybars: "1000000",
      refundTinybars: "0",
      latencyMs: 10,
      outcome: "ok",
      ts: new Date().toISOString(),
      network: "hedera:testnet",
      asset: "0.0.0",
    });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.call_id).toBe("call-1");
    expect(inserts[0]?.status).toBe("pending");
  });

  it("rejects non-HBAR asset before insert", async () => {
    const sink = new SupabaseEventSink({
      client: {
        from: () => ({
          insert: async () => ({ error: null }),
          update: () => ({ eq: async () => ({ error: null }) }),
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        rpc: async () => ({ data: [], error: null }),
      },
    });
    await expect(
      sink.publish({
        callId: "x",
        agentAccountId: "0.0.1",
        endpointSlug: "dummy",
        premiumTinybars: "0",
        refundTinybars: "0",
        latencyMs: 0,
        outcome: "ok",
        ts: new Date().toISOString(),
        network: "hedera:testnet",
        asset: "0.0.429274" as "0.0.0",
      }),
    ).rejects.toThrow(/HBAR/);
  });
});

describe("wrapFetch", () => {
  it("classifies 500 as server_error with refund event", async () => {
    const sink = new MemoryEventSink();
    const result = await wrapFetch({
      endpointSlug: "dummy",
      agentAccountId: "0.0.6111100",
      upstreamUrl: "https://example.invalid/x",
      endpointConfig,
      classifier: defaultClassifier,
      sink,
      fetchImpl: async () => new Response("err", { status: 500 }),
    });

    expect(result.outcome).toBe("server_error");
    expect(result.premiumTinybars).toBe(endpointConfig.flat_premium_tinybars);
    expect(result.refundTinybars).toBe(
      endpointConfig.imputed_cost_tinybars +
        endpointConfig.flat_premium_tinybars,
    );
    // allow microtask flush for fire-and-forget publish
    await Promise.resolve();
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]?.network).toBe("hedera:testnet");
    expect(sink.events[0]?.asset).toBe("0.0.0");
    expect(sink.events[0]?.outcome).toBe("server_error");
  });

  it("classifies thrown fetch as network_error", async () => {
    const sink = new MemoryEventSink();
    const result = await wrapFetch({
      endpointSlug: "dummy",
      agentAccountId: "0.0.6111100",
      upstreamUrl: "https://example.invalid/x",
      endpointConfig,
      classifier: defaultClassifier,
      sink,
      fetchImpl: async () => {
        throw new Error("boom");
      },
    });
    expect(result.outcome).toBe("network_error");
    expect(result.response.status).toBe(502);
  });

  it("marks slow 2xx as latency_breach", async () => {
    const sink = new MemoryEventSink();
    let t = 0;
    const result = await wrapFetch({
      endpointSlug: "dummy",
      agentAccountId: "0.0.6111100",
      upstreamUrl: "https://example.invalid/x",
      endpointConfig,
      classifier: defaultClassifier,
      sink,
      now: () => {
        const cur = t;
        t += 200;
        return cur;
      },
      fetchImpl: async () => new Response("ok", { status: 200 }),
    });
    expect(result.outcome).toBe("latency_breach");
    expect(result.latencyMs).toBe(200);
  });

  it("rejects wrong network", async () => {
    await expect(
      wrapFetch({
        endpointSlug: "dummy",
        agentAccountId: "0.0.1",
        upstreamUrl: "https://example.invalid",
        endpointConfig,
        classifier: defaultClassifier,
        sink: new MemoryEventSink(),
        network: "hedera:mainnet",
        fetchImpl: async () => new Response("ok"),
      }),
    ).rejects.toThrow(/hedera:testnet/);
  });

  it("rejects wrong asset", async () => {
    await expect(
      wrapFetch({
        endpointSlug: "dummy",
        agentAccountId: "0.0.1",
        upstreamUrl: "https://example.invalid",
        endpointConfig,
        classifier: defaultClassifier,
        sink: new MemoryEventSink(),
        asset: "0.0.429274",
        fetchImpl: async () => new Response("ok"),
      }),
    ).rejects.toThrow(/HBAR/);
  });
});
