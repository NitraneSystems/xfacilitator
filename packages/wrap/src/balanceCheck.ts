export type BalanceCheckRejectionReason =
  | "insufficient_balance"
  | "insufficient_allowance";

export type BalanceCheckResult =
  | { eligible: true; hbarTinybars: bigint }
  | {
      eligible: false;
      reason: BalanceCheckRejectionReason;
      hbarTinybars?: bigint;
    };

export interface BalanceCheck {
  /** requiredTinybars = premium to debit for this call. */
  check(
    agentAccountId: string,
    requiredTinybars: bigint,
  ): Promise<BalanceCheckResult>;
}
