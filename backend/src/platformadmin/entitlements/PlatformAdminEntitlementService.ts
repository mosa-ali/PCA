import { randomUUID } from 'node:crypto';
import { authorizePlatformAdminOperation } from '../auth/rbacPolicy.js';
import { insertPlatformAdminAuditEventRow } from '../audit/MySqlPlatformAdminAuditRepository.js';
import { runInTransaction } from '../../db/pool.js';
import type { PlatformAdminAuthService } from '../auth/PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId, PlatformAdminStepUpId } from '../auth/types.js';
import { EntitlementService } from '../../entitlements/EntitlementService.js';
import { ChangeRequestService } from '../../entitlements/requests/ChangeRequestService.js';
import { SlotReservationService } from '../../entitlements/slots/SlotReservationService.js';
import type { EntitlementRepository } from '../../entitlements/EntitlementRepository.js';
import type { ChangeRequestRepository } from '../../entitlements/requests/ChangeRequestRepository.js';
import type { AccountEntitlementRecord, EntitlementChangeRequestRecord, EntitlementReadModel, LimitType, OpaqueFamilyId, SlotReservationRecord } from '../../entitlements/types.js';

export interface PlatformAdminActor {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
  sessionId: PlatformAdminSessionId;
}

export type PlatformAdminEntitlementErrorCode = 'FORBIDDEN' | 'STEP_UP_REQUIRED';

export class PlatformAdminEntitlementError extends Error {
  readonly code: PlatformAdminEntitlementErrorCode;
  constructor(code: PlatformAdminEntitlementErrorCode) {
    super(`Platform Administration entitlement operation denied: ${code}`);
    this.name = 'PlatformAdminEntitlementError';
    this.code = code;
  }
}

/**
 * Backend domain/service operations for Platform Administration's
 * entitlement/enrollment-limit surface (Addendum 002 Section 31). No HTTP
 * routes are implemented in this lane -- see PCA-PA-2's final report.
 *
 * RBAC/step-up are reused verbatim from the accepted PCA-PA-1 lane:
 * `ADMINISTER_ENTITLEMENT_QUANTITY` (already present in
 * backend/src/platformadmin/auth/rbacPolicy.ts's OPERATION_MATRIX, ALLOW
 * only for APP_OWNER/PLATFORM_ADMIN, exactly matching Section 3.7's
 * "Entitlement quantity administration" row) gates every mutation here, and
 * `ENTITLEMENT_LIMIT_OVERRIDE` (already present in
 * backend/src/platformadmin/auth/types.ts's PLATFORM_ADMIN_STEP_UP_SCOPES)
 * gates the no-charge override specifically. Read operations reuse
 * `VIEW_SUPPORT_ACCOUNT_METADATA` (ALLOW for every role, matching Section
 * 3.7's "Support-scoped account/license/enrollment metadata" row). No new
 * operation or step-up scope was added to rbacPolicy.ts/types.ts by this
 * lane -- Agent41 already anticipated this exact surface.
 */
export class PlatformAdminEntitlementService {
  private readonly authService: PlatformAdminAuthService;
  private readonly entitlementRepository: EntitlementRepository;
  private readonly changeRequestRepository: ChangeRequestRepository;
  private readonly entitlementService: EntitlementService;
  private readonly changeRequestService: ChangeRequestService;
  private readonly slotReservationService: SlotReservationService;
  private readonly now: () => Date;

  constructor(
    authService: PlatformAdminAuthService,
    entitlementRepository: EntitlementRepository,
    changeRequestRepository: ChangeRequestRepository,
    entitlementService: EntitlementService,
    changeRequestService: ChangeRequestService,
    slotReservationService: SlotReservationService,
    now: () => Date = () => new Date(),
  ) {
    this.authService = authService;
    this.entitlementRepository = entitlementRepository;
    this.changeRequestRepository = changeRequestRepository;
    this.entitlementService = entitlementService;
    this.changeRequestService = changeRequestService;
    this.slotReservationService = slotReservationService;
    this.now = now;
  }

  private requireView(actor: PlatformAdminActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') throw new PlatformAdminEntitlementError('FORBIDDEN');
  }

  private requireQuantityAdmin(actor: PlatformAdminActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'ADMINISTER_ENTITLEMENT_QUANTITY') !== 'ALLOW') throw new PlatformAdminEntitlementError('FORBIDDEN');
  }

  private requireBillingAdmin(actor: PlatformAdminActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'ADMINISTER_BILLING') !== 'ALLOW') throw new PlatformAdminEntitlementError('FORBIDDEN');
  }

  async readEntitlement(actor: PlatformAdminActor, familyId: OpaqueFamilyId): Promise<EntitlementReadModel> {
    this.requireView(actor);
    return this.entitlementService.buildReadModel(familyId, this.now());
  }

  async readUsage(actor: PlatformAdminActor, familyId: OpaqueFamilyId): Promise<AccountEntitlementRecord> {
    this.requireView(actor);
    return this.entitlementService.getOrCreateForFamily(familyId, this.now());
  }

  async readRequests(actor: PlatformAdminActor, familyId: OpaqueFamilyId): Promise<EntitlementChangeRequestRecord[]> {
    this.requireView(actor);
    return this.changeRequestRepository.listForFamily(familyId);
  }

  async viewReservations(actor: PlatformAdminActor, familyId: OpaqueFamilyId): Promise<SlotReservationRecord[]> {
    this.requireView(actor);
    return this.slotReservationService.listForFamily(familyId);
  }

  /** PCA-ADD-PA-054: non-billable, PLATFORM_ADMIN-or-above, no step-up required (only sensitive overrides require step-up per PCA-ADD-PA-017). */
  async approveParentMemberRequest(actor: PlatformAdminActor, requestId: string): Promise<EntitlementChangeRequestRecord> {
    this.requireQuantityAdmin(actor);
    return this.changeRequestService.approveParentMemberRequest(requestId, actor.adminId);
  }

  async denyRequest(actor: PlatformAdminActor, requestId: string, reason: string): Promise<EntitlementChangeRequestRecord> {
    this.requireQuantityAdmin(actor);
    return this.changeRequestService.deny(requestId, actor.adminId, reason);
  }

  async issueCustomQuote(actor: PlatformAdminActor, requestId: string, amountMinor: bigint, currencyCode: string): Promise<EntitlementChangeRequestRecord> {
    this.requireBillingAdmin(actor);
    return this.changeRequestService.issueCustomQuote(requestId, { amountMinor, currencyCode, actorAdminId: actor.adminId });
  }

  /**
   * PCA-ADD-PA-017/054: sensitive no-charge device-limit override. Requires
   * a caller-supplied, already-asserted step-up grant (from
   * PlatformAdminAuthService.assertStepUp with scope
   * ENTITLEMENT_LIMIT_OVERRIDE) which is consumed (single-use) here, atomic
   * with the entitlement raise -- a denied/expired/already-consumed step-up
   * throws PlatformAdminAuthError before any mutation occurs.
   */
  async noChargeDeviceOverride(actor: PlatformAdminActor, familyId: OpaqueFamilyId, targetLimit: number, reason: string, stepUpId: PlatformAdminStepUpId): Promise<EntitlementChangeRequestRecord> {
    this.requireQuantityAdmin(actor);
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'ENTITLEMENT_LIMIT_OVERRIDE');
    return this.changeRequestService.createAndApproveNoChargeDeviceIncrease(familyId, targetLimit, actor.adminId, reason);
  }

  /** PCA-ADD-PA-024: durable, configurable FREE_STARTER default change -- never rewrites existing account_entitlements rows. */
  async updateFreeStarterDefaults(actor: PlatformAdminActor, parentMemberLimit: number, managedDeviceLimit: number): Promise<void> {
    this.requireQuantityAdmin(actor);
    await this.entitlementRepository.updateDefaults('FREE_STARTER', parentMemberLimit, managedDeviceLimit, actor.adminId, this.now());
  }

  /**
   * Direct PLATFORM_ADMIN/APP_OWNER entitlement-quantity administration
   * (Section 3.2/3.7's "Entitlement quantity administration" row) --
   * outside the increase-request lifecycle. Supports raising OR lowering a
   * limit; PCA-ADD-PA-023 governs the lowering case: existing occupants in
   * excess of the new limit are never force-removed here, only the
   * over-limit flag is recomputed (see EntitlementRepository.raiseLimit).
   */
  async setEntitlementLimit(actor: PlatformAdminActor, familyId: OpaqueFamilyId, limitType: LimitType, targetLimit: number): Promise<AccountEntitlementRecord> {
    this.requireQuantityAdmin(actor);
    if (!Number.isInteger(targetLimit) || targetLimit < 0) throw new Error('targetLimit must be a non-negative integer');
    const now = this.now();
    await this.entitlementService.getOrCreateForFamily(familyId, now);
    return runInTransaction(async (conn) => {
      await this.entitlementRepository.lockForFamily(conn, familyId);
      const updated = await this.entitlementRepository.raiseLimit(conn, familyId, limitType, targetLimit, now);
      await insertPlatformAdminAuditEventRow(conn, {
        eventId: randomUUID(),
        eventType: 'DEVICE_LIMIT_CHANGED',
        actorAdminId: actor.adminId,
        actorRole: actor.roles[0] ?? null,
        targetRef: `family:${familyId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { limitType, targetLimit },
      });
      return updated;
    });
  }
}
