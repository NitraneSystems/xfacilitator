# x500 Facilitator

x402 Exact HBAR facilitator (`/verify`, `/settle`, `/supported`) plus coverage register.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm build
pnpm start
```

Default port: `8791` (`FACILITATOR_PORT`). Requires `HEDERA_NETWORK=hedera:testnet`.
