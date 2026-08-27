import type { OvernightExecutionProvider } from "../../src/shared/contracts";

/**
 * Narrow contracts shared by the portfolio ledger and the production
 * provider control plane. Concrete verification and launch logic lives in the
 * production implementation that actually runs; there is no parallel generic
 * control plane.
 */

export interface PrivateApprovedLaunchInput {
  planId: string;
  runId: string;
  itemId: string;
  provider: OvernightExecutionProvider;
  approvalClaimSha256: string;
  fixedRoot: string;
  worktreeKey: string;
  runtimeDirectory: string;
  writeScopes: readonly string[];
}

export interface ConsumedApprovedLaunchClaim extends PrivateApprovedLaunchInput {}

export interface ApprovedLaunchClaimPort {
  consume(
    input: Readonly<PrivateApprovedLaunchInput>,
  ): Promise<Readonly<ConsumedApprovedLaunchClaim> | undefined>;
}

export type ProviderPlanningInspection =
  | {
    status: "ready";
    provider: OvernightExecutionProvider;
    executableSha256: string;
    identitySha256: string;
    attestationSha256: string;
    expiresAt: string;
  }
  | { status: "setup"; provider: OvernightExecutionProvider; reason: string }
  | { status: "blocked"; provider: OvernightExecutionProvider; reason: string };

export interface PreparedApprovedLaunch<TBinding> {
  status: "verified";
  provider: OvernightExecutionProvider;
  attestationSha256: string;
  /** The concrete binding is exposed only to the immediate launch handoff. */
  withPrivateBinding<T>(consumer: (binding: TBinding) => Promise<T>): Promise<T>;
  cleanup(): Promise<void>;
}

export type ApprovedLaunchResult<TBinding> = PreparedApprovedLaunch<TBinding> | {
  status: "blocked";
  provider: OvernightExecutionProvider;
  reason: string;
};
