import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import {
  insertSettleJob,
  type SettleJobsClient,
} from "@x500/db";
import {
  assertHbarAsset,
  assertHederaTestnet,
  type SettlementEvent,
} from "./types.js";

export interface EventSink {
  publish(event: SettlementEvent): Promise<void>;
}

export class MemoryEventSink implements EventSink {
  public readonly events: SettlementEvent[] = [];

  async publish(event: SettlementEvent): Promise<void> {
    assertHederaTestnet(event.network);
    assertHbarAsset(event.asset);
    this.events.push(event);
  }

  reset(): void {
    this.events.length = 0;
  }
}

export interface SupabaseEventSinkOptions {
  /** Prebuilt client (tests / DI). */
  client?: SettleJobsClient | SupabaseClient;
  url?: string;
  serviceRoleKey?: string;
}

/**
 * Durable sink: INSERT into settle_jobs for Phase 4 settler consumption.
 * Throws on missing config or DB errors — never a silent no-op.
 */
export class SupabaseEventSink implements EventSink {
  private readonly client: SettleJobsClient;

  constructor(opts: SupabaseEventSinkOptions = {}) {
    if (opts.client) {
      this.client = opts.client as SettleJobsClient;
      return;
    }
    const url = opts.url ?? process.env.SUPABASE_URL?.trim();
    const key =
      opts.serviceRoleKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!url || !key) {
      throw new Error(
        "SupabaseEventSink requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or client)",
      );
    }
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        transport: WebSocket as any,
      },
    }) as unknown as SettleJobsClient;
  }

  async publish(event: SettlementEvent): Promise<void> {
    assertHederaTestnet(event.network);
    assertHbarAsset(event.asset);
    if (!event.callId?.trim()) {
      throw new Error("SupabaseEventSink: callId required");
    }
    await insertSettleJob(this.client, {
      callId: event.callId,
      payload: { ...event },
    });
  }
}
