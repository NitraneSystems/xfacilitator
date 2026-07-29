/**
 * HBAR-only guards for payment requirements (unit-tested).
 */
import { describe, expect, it } from "vitest";
import {
  assertHbarExactRequirements,
  HBAR_ASSET,
  HEDERA_TESTNET,
  HEDERA_TESTNET_USDC,
} from "./hbar.js";

describe("assertHbarExactRequirements", () => {
  it("accepts HBAR on testnet", () => {
    expect(() =>
      assertHbarExactRequirements({
        asset: HBAR_ASSET,
        network: HEDERA_TESTNET,
      }),
    ).not.toThrow();
  });

  it("rejects USDC asset id", () => {
    expect(() =>
      assertHbarExactRequirements({
        asset: HEDERA_TESTNET_USDC,
        network: HEDERA_TESTNET,
      }),
    ).toThrow(/HBAR|0\.0\.0|USDC/);
  });

  it("rejects wrong network", () => {
    expect(() =>
      assertHbarExactRequirements({
        asset: HBAR_ASSET,
        network: "hedera:mainnet",
      }),
    ).toThrow(/hedera:testnet/);
  });
});
