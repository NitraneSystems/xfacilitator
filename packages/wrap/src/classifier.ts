import { classifyHttpOutcome } from "@x500/classifier";
import { computeEconomics } from "./economics.js";
import type { Outcome } from "./types.js";

export interface ClassifierInput {
  response: Response | null;
  latencyMs: number;
  endpointConfig: {
    sla_latency_ms: number;
    flat_premium_tinybars: bigint;
    imputed_cost_tinybars: bigint;
  };
}

export interface ClassifierResult {
  outcome: Outcome;
  premium: bigint;
  refund: bigint;
}

export interface Classifier {
  classify(input: ClassifierInput): ClassifierResult;
}

export const defaultClassifier: Classifier = {
  classify({ response, latencyMs, endpointConfig }: ClassifierInput): ClassifierResult {
    const category = classifyHttpOutcome({
      statusCode: response === null ? null : response.status,
      latencyMs,
      latencyThresholdMs: endpointConfig.sla_latency_ms,
      networkError: response === null,
    });

    let outcome: Outcome;
    switch (category) {
      case "network_error":
        outcome = "network_error";
        break;
      case "server_error":
        outcome = "server_error";
        break;
      case "client_error":
        outcome = "client_error";
        break;
      case "slow":
        outcome = "latency_breach";
        break;
      case "success":
      case "other":
        outcome = "ok";
        break;
      default: {
        const _: never = category;
        outcome = _;
      }
    }

    const econ = computeEconomics({
      outcome,
      pool: {
        flatPremiumTinybars: endpointConfig.flat_premium_tinybars,
        imputedCostTinybars: endpointConfig.imputed_cost_tinybars,
      },
    });
    return {
      outcome: econ.outcome,
      premium: econ.premiumTinybars,
      refund: econ.refundTinybars,
    };
  },
};

export function composeWithDefault(
  pluginFn: (input: ClassifierInput) => ClassifierResult | null,
): Classifier {
  return {
    classify(input: ClassifierInput): ClassifierResult {
      const pluginResult = pluginFn(input);
      if (pluginResult !== null) return pluginResult;
      return defaultClassifier.classify(input);
    },
  };
}
