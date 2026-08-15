/**
 * PCA-BILL-3 (Writer62, Round6) -- Platform-Administration-facing service
 * for Settlement / Reconciliation (SETTLEMENT_RECONCILIATION_V1). Composes
 * (never duplicates) the plain `SettlementService` for every business
 * decision, adding: RBAC (VIEW_SETTLEMENT_RECORDS / MUTATE_SETTLEMENT_ACCOUNT
 * / CREATE_SETTLEMENT_BATCH / RESOLVE_RECONCILIATION, rbacPolicy.ts), fresh
 * step-up on every mutation (SETTLEMENT_BANK_CONFIG scope, reused verbatim
 * from platformadmin/auth/types.ts -- already reserved there, never a new
 * scope added by this lane), and the masked-read boundary: every view
 * returned by this service omits `providerRef` entirely (the opaque
 * secret-reference token itself), returning only the pre-masked
 * `displayLabel` and non-sensitive fields -- mirrors
 * PlatformAdminComplimentaryGrantService's composition pattern exactly.
 */
import { authorizePlatformAdminOperation } from '../auth/rbacPolicy.js';
import type { PlatformAdminAuthService } from '../auth/PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId, PlatformAdminStepUpId } from '../auth/types.js';
import type { AttributeTransactionRequest, SettlementActor, SettlementService } from '../../billing/settlement/SettlementService.js';
import type {
  CreateSettlementAccountInput,
  OpenSettlementBatchInput,
  SettlementAccountRecord,
  SettlementBatchItemRecord,
  SettlementBatchRecord,
  SettlementDashboardSummary,
} from '../../billing/settlement/types.js';

export interface PlatformAdminSettlementActor {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
  sessionId: PlatformAdminSessionId;
}

export type PlatformAdminSettlementErrorCode = 'FORBIDDEN' | 'STEP_UP_REQUIRED';

export class PlatformAdminSettlementError extends Error {
  readonly code: PlatformAdminSettlementErrorCode;
  constructor(code: PlatformAdminSettlementErrorCode) {
    super(`Platform Administration settlement operation denied: ${code}`);
    this.name = 'PlatformAdminSettlementError';
    this.code = code;
  }
}

/** Every settlement mutation requires fresh step-up under this scope -- SETTLEMENT_BANK_CONFIG, already reserved in platformadmin/auth/types.ts's PLATFORM_ADMIN_STEP_UP_SCOPES since migration 0005, reused verbatim (this lane adds no new step-up scope). */
const SETTLEMENT_STEP_UP_SCOPE = 'SETTLEMENT_BANK_CONFIG' as const;

/** Masked account view -- providerRef is NEVER included, by construction (there is no field for it in this interface at all, not merely omitted at serialization time). */
export interface SettlementAccountView {
  settlementAccountId: string;
  displayLabel: string;
  settlementCurrency: SettlementAccountRecord['settlementCurrency'];
  status: SettlementAccountRecord['status'];
  createdAt: Date;
  updatedAt: Date;
}

function toAccountView(record: SettlementAccountRecord): SettlementAccountView {
  return {
    settlementAccountId: record.settlementAccountId,
    displayLabel: record.displayLabel,
    settlementCurrency: record.settlementCurrency,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** Batch view: providerRef is the settlement PROVIDER's own batch/report reference (e.g. a payout-report id) -- distinct from an account secret-reference, but still opaque and non-sensitive; included as-is since it carries no banking-secret material and is useful for admins reconciling against the provider's own report. */
export interface SettlementBatchView extends SettlementBatchRecord {}

export interface CreateSettlementAccountRequest extends CreateSettlementAccountInput {
  stepUpId: PlatformAdminStepUpId;
}

export interface SetSettlementAccountStatusRequest {
  status: 'ACTIVE' | 'INACTIVE';
  stepUpId: PlatformAdminStepUpId;
}

export interface OpenSettlementBatchRequest extends Omit<OpenSettlementBatchInput, 'createdByAdminId'> {
  stepUpId: PlatformAdminStepUpId;
}

export interface AttributeTransactionServiceRequest extends AttributeTransactionRequest {
  stepUpId: PlatformAdminStepUpId;
}

export class PlatformAdminSettlementService {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly settlementService: SettlementService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private requireRead(actor: PlatformAdminSettlementActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'VIEW_SETTLEMENT_RECORDS') !== 'ALLOW') throw new PlatformAdminSettlementError('FORBIDDEN');
  }

  private requireMutateAccount(actor: PlatformAdminSettlementActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'MUTATE_SETTLEMENT_ACCOUNT') !== 'ALLOW') throw new PlatformAdminSettlementError('FORBIDDEN');
  }

  private requireCreateBatch(actor: PlatformAdminSettlementActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'CREATE_SETTLEMENT_BATCH') !== 'ALLOW') throw new PlatformAdminSettlementError('FORBIDDEN');
  }

  private requireResolve(actor: PlatformAdminSettlementActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'RESOLVE_RECONCILIATION') !== 'ALLOW') throw new PlatformAdminSettlementError('FORBIDDEN');
  }

  private async stepUp(actor: PlatformAdminSettlementActor, stepUpId: PlatformAdminStepUpId): Promise<void> {
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, SETTLEMENT_STEP_UP_SCOPE);
  }

  private settlementActor(actor: PlatformAdminSettlementActor): SettlementActor {
    // Multi-role admins: the audit row records the FIRST role in the
    // actor's role list, matching PlatformAdminComplimentaryGrantService's
    // existing convention of treating roles as a set for authorization
    // (authorizePlatformAdminOperation: ALLOW if ANY role allows) while
    // still needing a single actorRole value for the audit row schema.
    return { adminId: actor.adminId, role: actor.roles[0] };
  }

  // ---- Settlement Accounts ----

  async listAccounts(actor: PlatformAdminSettlementActor): Promise<SettlementAccountView[]> {
    this.requireRead(actor);
    const records = await this.settlementService.listAccounts();
    return records.map(toAccountView);
  }

  async getAccount(actor: PlatformAdminSettlementActor, settlementAccountId: string): Promise<SettlementAccountView> {
    this.requireRead(actor);
    const record = await this.settlementService.getAccount(settlementAccountId);
    return toAccountView(record);
  }

  async createAccount(actor: PlatformAdminSettlementActor, request: CreateSettlementAccountRequest): Promise<SettlementAccountView> {
    this.requireMutateAccount(actor);
    await this.stepUp(actor, request.stepUpId);
    const record = await this.settlementService.createAccount(
      { providerRef: request.providerRef, displayLabel: request.displayLabel, settlementCurrency: request.settlementCurrency },
      this.settlementActor(actor),
      this.now(),
    );
    return toAccountView(record);
  }

  async setAccountStatus(actor: PlatformAdminSettlementActor, settlementAccountId: string, request: SetSettlementAccountStatusRequest): Promise<SettlementAccountView> {
    this.requireMutateAccount(actor);
    await this.stepUp(actor, request.stepUpId);
    const record = await this.settlementService.setAccountStatus(settlementAccountId, request.status, this.settlementActor(actor), this.now());
    return toAccountView(record);
  }

  // ---- Settlement Batches / Reconciliation ----

  async listAllBatches(actor: PlatformAdminSettlementActor): Promise<SettlementBatchView[]> {
    this.requireRead(actor);
    return this.settlementService.listAllBatches();
  }

  async listBatchesForAccount(actor: PlatformAdminSettlementActor, settlementAccountRef: string): Promise<SettlementBatchView[]> {
    this.requireRead(actor);
    return this.settlementService.listBatchesForAccount(settlementAccountRef);
  }

  async getBatch(actor: PlatformAdminSettlementActor, settlementBatchId: string): Promise<SettlementBatchView> {
    this.requireRead(actor);
    return this.settlementService.getBatch(settlementBatchId);
  }

  async listItemsForBatch(actor: PlatformAdminSettlementActor, settlementBatchId: string): Promise<SettlementBatchItemRecord[]> {
    this.requireRead(actor);
    return this.settlementService.listItemsForBatch(settlementBatchId);
  }

  async openBatch(actor: PlatformAdminSettlementActor, request: OpenSettlementBatchRequest): Promise<SettlementBatchView> {
    this.requireCreateBatch(actor);
    await this.stepUp(actor, request.stepUpId);
    return this.settlementService.openBatch(
      {
        settlementAccountRef: request.settlementAccountRef,
        settlementCurrency: request.settlementCurrency,
        periodStart: request.periodStart,
        periodEnd: request.periodEnd,
        expectedGross: request.expectedGross,
        fees: request.fees,
        received: request.received,
        providerRef: request.providerRef,
        createdByAdminId: actor.adminId,
      },
      this.settlementActor(actor),
      this.now(),
    );
  }

  async attributeTransaction(actor: PlatformAdminSettlementActor, request: AttributeTransactionServiceRequest): Promise<SettlementBatchItemRecord> {
    this.requireCreateBatch(actor);
    await this.stepUp(actor, request.stepUpId);
    return this.settlementService.attributeTransaction(
      { settlementBatchId: request.settlementBatchId, paymentTransactionId: request.paymentTransactionId, fx: request.fx },
      this.settlementActor(actor),
      this.now(),
    );
  }

  async resolveReconciliation(actor: PlatformAdminSettlementActor, settlementBatchId: string, reason: string, stepUpId: PlatformAdminStepUpId): Promise<SettlementBatchView> {
    this.requireResolve(actor);
    await this.stepUp(actor, stepUpId);
    return this.settlementService.resolveReconciliation(settlementBatchId, reason, this.settlementActor(actor), this.now());
  }

  // ---- Dashboard (COORDINATOR_BINDING_REQUIRED, see final report) ----

  async dashboardSummary(actor: PlatformAdminSettlementActor): Promise<SettlementDashboardSummary> {
    this.requireRead(actor);
    return this.settlementService.dashboardSummary();
  }
}
