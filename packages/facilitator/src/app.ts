import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  assertHbarExactRequirements,
  createLiveFacilitatorSigner,
  HBAR_ASSET,
  HEDERA_TESTNET,
} from "./hbar.js";
import {
  getCoverage,
  registerCoverage,
  wellKnownPayCoverage,
} from "./coverage.js";

export const PACKAGE_NAME = "@x500/facilitator" as const;

export function createFacilitatorApp(): Hono {
  if (process.env.HEDERA_NETWORK?.trim() !== HEDERA_TESTNET) {
    throw new Error(
      `facilitator refuses boot: HEDERA_NETWORK must be ${HEDERA_TESTNET}`,
    );
  }
  const accountId = process.env.X500_FACILITATOR_ACCOUNT_ID?.trim();
  const key = process.env.HEDERA_FACILITATOR_PRIVATE_KEY?.trim();
  if (!accountId || !key) {
    throw new Error(
      "X500_FACILITATOR_ACCOUNT_ID + HEDERA_FACILITATOR_PRIVATE_KEY required",
    );
  }

  const signer = createLiveFacilitatorSigner(accountId, key);
  const scheme = new ExactHederaScheme(signer, { aliasPolicy: "reject" });
  const facilitator = new x402Facilitator().register(HEDERA_TESTNET, scheme);

  facilitator.onBeforeVerify(async ({ requirements }) => {
    try {
      assertHbarExactRequirements({
        asset: requirements.asset,
        network: requirements.network,
      });
    } catch (err) {
      return {
        abort: true as const,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });

  facilitator.onBeforeSettle(async ({ requirements }) => {
    try {
      assertHbarExactRequirements({
        asset: requirements.asset,
        network: requirements.network,
      });
    } catch (err) {
      return {
        abort: true as const,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  });

  const app = new Hono();

  app.get("/health", (c) =>
    c.json({
      ok: true,
      service: "facilitator",
      network: HEDERA_TESTNET,
      asset: HBAR_ASSET,
      facilitatorAccountId: accountId,
    }),
  );

  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  app.post("/verify", async (c) => {
    const body = (await c.req.json()) as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    try {
      assertHbarExactRequirements({
        asset: body.paymentRequirements?.asset,
        network: body.paymentRequirements?.network,
      });
    } catch (err) {
      return c.json(
        {
          isValid: false,
          invalidReason: "unsupported_asset_or_network",
          invalidMessage: err instanceof Error ? err.message : String(err),
        },
        400,
      );
    }
    const result = await facilitator.verify(
      body.paymentPayload,
      body.paymentRequirements,
    );
    return c.json(result);
  });

  app.post("/settle", async (c) => {
    const body = (await c.req.json()) as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    try {
      assertHbarExactRequirements({
        asset: body.paymentRequirements?.asset,
        network: body.paymentRequirements?.network,
      });
    } catch (err) {
      return c.json(
        {
          success: false,
          errorReason: "unsupported_asset_or_network",
          errorMessage: err instanceof Error ? err.message : String(err),
          transaction: "",
          network: body.paymentRequirements?.network ?? "",
        },
        400,
      );
    }
    const result = await facilitator.settle(
      body.paymentPayload,
      body.paymentRequirements,
    );
    return c.json(result);
  });

  app.get("/.well-known/pay-coverage", wellKnownPayCoverage);
  app.post("/v1/coverage/register", (c) => registerCoverage(c));
  app.get("/v1/coverage/:id", getCoverage);

  return app;
}

export function startFacilitator(
  port = Number(
    process.env.PORT ?? process.env.FACILITATOR_PORT ?? 8791,
  ),
) {
  const app = createFacilitatorApp();
  return serve({ fetch: app.fetch, port }, () => {
    console.log(`[facilitator] listening on :${port}`);
  });
}
