-- Enable gen_random_uuid if needed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- x500 Phase 3 schema: HBAR tinybars only, network hedera:testnet
-- asset column (where present) must be 0.0.0

CREATE TABLE IF NOT EXISTS endpoints (
  slug TEXT PRIMARY KEY,
  network TEXT NOT NULL DEFAULT 'hedera:testnet',
  hostname TEXT NOT NULL,
  sla_ms INTEGER NOT NULL,
  flat_premium_tinybars BIGINT NOT NULL,
  imputed_cost_tinybars BIGINT NOT NULL DEFAULT 0,
  percent_bps INTEGER NOT NULL DEFAULT 0,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  pool_balance_tinybars BIGINT NOT NULL DEFAULT 0,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT endpoints_network_check CHECK (network = 'hedera:testnet')
);

CREATE TABLE IF NOT EXISTS agents (
  account_id TEXT PRIMARY KEY,
  total_premiums_tinybars BIGINT NOT NULL DEFAULT 0,
  total_refunds_tinybars BIGINT NOT NULL DEFAULT 0,
  call_count BIGINT NOT NULL DEFAULT 0,
  last_call_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calls (
  call_id TEXT PRIMARY KEY,
  agent_account_id TEXT NOT NULL REFERENCES agents(account_id),
  endpoint_slug TEXT NOT NULL REFERENCES endpoints(slug),
  outcome TEXT NOT NULL,
  latency_ms INTEGER NOT NULL,
  premium_tinybars BIGINT NOT NULL,
  refund_tinybars BIGINT NOT NULL DEFAULT 0,
  breach BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'settled',
  network TEXT NOT NULL DEFAULT 'hedera:testnet',
  asset TEXT NOT NULL DEFAULT '0.0.0',
  settlement_tx_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT calls_network_check CHECK (network = 'hedera:testnet'),
  CONSTRAINT calls_asset_check CHECK (asset = '0.0.0')
);

CREATE INDEX IF NOT EXISTS calls_agent_idx ON calls(agent_account_id);
CREATE INDEX IF NOT EXISTS calls_endpoint_idx ON calls(endpoint_slug);
CREATE INDEX IF NOT EXISTS calls_created_idx ON calls(created_at DESC);

CREATE TABLE IF NOT EXISTS settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id TEXT NOT NULL UNIQUE,
  consensus_timestamp TEXT,
  network TEXT NOT NULL DEFAULT 'hedera:testnet',
  asset TEXT NOT NULL DEFAULT '0.0.0',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT settlements_network_check CHECK (network = 'hedera:testnet'),
  CONSTRAINT settlements_asset_check CHECK (asset = '0.0.0')
);

CREATE TABLE IF NOT EXISTS settlement_fee_shares (
  id BIGSERIAL PRIMARY KEY,
  settlement_id UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  recipient_account_id TEXT NOT NULL,
  amount_tinybars BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS settle_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'done', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  leased_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settle_jobs_status_idx ON settle_jobs(status, created_at);

CREATE TABLE IF NOT EXISTS pool_state (
  endpoint_slug TEXT PRIMARY KEY REFERENCES endpoints(slug),
  balance_tinybars BIGINT NOT NULL DEFAULT 0,
  escrow_tinybars BIGINT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
