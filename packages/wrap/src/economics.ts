import type { Outcome } from "./types.js";

export interface EconomicsPool {
  flatPremiumTinybars: bigint;
  imputedCostTinybars: bigint;
}

export interface Economics {
  outcome: Outcome;
  premiumTinybars: bigint;
  refundTinybars: bigint;
  covered: boolean;
}

export function isCoveredBreach(outcome: Outcome): boolean {
  return (
    outcome === "latency_breach" ||
    outcome === "server_error" ||
    outcome === "network_error"
  );
}

/**
 * Premium + refund for a classified outcome (tinybars).
 *
 * Covered breach refund = principal + flatPremium, with principal =
 * amountPaid (if provided) else imputedCost, clamped to imputedCost.
 */
export function computeEconomics(args: {
  outcome: Outcome;
  pool: EconomicsPool;
  amountPaid?: bigint;
}): Economics {
  const { outcome, pool, amountPaid } = args;

  if (outcome === "client_error") {
    return {
      outcome,
      premiumTinybars: 0n,
      refundTinybars: 0n,
      covered: false,
    };
  }

  let refund = 0n;
  if (isCoveredBreach(outcome)) {
    const requested =
      amountPaid === undefined ? pool.imputedCostTinybars : amountPaid;
    const principal =
      requested < 0n
        ? 0n
        : requested > pool.imputedCostTinybars
          ? pool.imputedCostTinybars
          : requested;
    refund = principal + pool.flatPremiumTinybars;
  }

  return {
    outcome,
    premiumTinybars: pool.flatPremiumTinybars,
    refundTinybars: refund,
    covered: true,
  };
}
