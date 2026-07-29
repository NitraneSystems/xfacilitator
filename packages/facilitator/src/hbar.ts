import {
  AccountId,
  Client,
  PrivateKey,
  createHederaPreflightTransfer,
  createHederaSignAndSubmitTransaction,
  createHederaVerifyPayerSignature,
  type FacilitatorHederaSigner,
} from "@x402/hedera";

export const HBAR_ASSET = "0.0.0" as const;
export const HEDERA_TESTNET = "hedera:testnet" as const;
export const HEDERA_TESTNET_USDC = "0.0.429274" as const;

export function assertHbarExactRequirements(reqs: {
  asset?: string;
  network?: string;
}): void {
  if (reqs.network !== HEDERA_TESTNET) {
    throw new Error(
      `only ${HEDERA_TESTNET} accepted (got ${JSON.stringify(reqs.network)})`,
    );
  }
  if (reqs.asset !== HBAR_ASSET) {
    throw new Error(
      `only HBAR asset ${HBAR_ASSET} accepted (got ${JSON.stringify(reqs.asset)}; USDC ${HEDERA_TESTNET_USDC} rejected)`,
    );
  }
}

export function createLiveFacilitatorSigner(
  accountId: string,
  privateKeyHex: string,
): FacilitatorHederaSigner {
  const key = PrivateKey.fromStringECDSA(privateKeyHex);
  const buildClient = (network: string): Client => {
    const client =
      network === "hedera:mainnet" ? Client.forMainnet() : Client.forTestnet();
    client.setOperator(AccountId.fromString(accountId), key);
    return client;
  };
  return {
    getAddresses: () => [accountId],
    signAndSubmitTransaction: createHederaSignAndSubmitTransaction(
      buildClient,
      key,
    ),
    resolveAccount: async () => ({ exists: true, isAlias: false }),
    verifyPayerSignature: createHederaVerifyPayerSignature(),
    preflightTransfer: createHederaPreflightTransfer(),
  };
}
