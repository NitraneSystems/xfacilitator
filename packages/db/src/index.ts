export const PACKAGE_NAME = "@x500/db" as const;

export const TABLES = [
  "endpoints",
  "agents",
  "calls",
  "settlements",
  "settlement_fee_shares",
  "settle_jobs",
  "pool_state",
] as const;

export type TableName = (typeof TABLES)[number];

export type SettleJobStatus = "pending" | "leased" | "done" | "failed";

export interface SettleJobRow {
  id: string;
  call_id: string;
  payload: Record<string, unknown>;
  status: SettleJobStatus;
  attempts: number;
  leased_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Minimal PostgREST-shaped client used by wrap sink + settler. */
export interface SettleJobsClient {
  from: (table: string) => {
    insert: (row: Record<string, unknown>) => PromiseLike<{
      error: { message: string; code?: string } | null;
    }>;
    update: (row: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string,
      ) => PromiseLike<{ error: { message: string } | null }>;
    };
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{
    data: SettleJobRow[] | null;
    error: { message: string; code?: string } | null;
  }>;
}

export async function insertSettleJob(
  client: SettleJobsClient,
  input: {
    callId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await client.from("settle_jobs").insert({
    call_id: input.callId,
    payload: input.payload,
    status: "pending",
  });
  if (error) {
    throw new Error(`insertSettleJob failed: ${error.message}`);
  }
}

export async function claimSettleJobs(
  client: SettleJobsClient,
  opts: { limit: number; worker: string; leaseSeconds?: number },
): Promise<SettleJobRow[]> {
  const { data, error } = await client.rpc("claim_settle_jobs", {
    p_limit: opts.limit,
    p_worker: opts.worker,
    p_lease_seconds: opts.leaseSeconds ?? 60,
  });
  if (error) {
    throw new Error(`claim_settle_jobs failed: ${error.message}`);
  }
  return data ?? [];
}

export async function completeSettleJob(
  client: SettleJobsClient,
  id: string,
): Promise<void> {
  const { error } = await client.rpc("complete_settle_job", { p_id: id });
  if (error) {
    throw new Error(`complete_settle_job failed: ${error.message}`);
  }
}

export async function failSettleJob(
  client: SettleJobsClient,
  opts: {
    id: string;
    error: string;
    maxAttempts?: number;
    requeue?: boolean;
  },
): Promise<void> {
  const { error } = await client.rpc("fail_settle_job", {
    p_id: opts.id,
    p_error: opts.error,
    p_max_attempts: opts.maxAttempts ?? 5,
    p_requeue: opts.requeue ?? true,
  });
  if (error) {
    throw new Error(`fail_settle_job failed: ${error.message}`);
  }
}
