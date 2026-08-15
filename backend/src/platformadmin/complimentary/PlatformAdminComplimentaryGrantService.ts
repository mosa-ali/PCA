import { authorizePlatformAdminOperation } from '../auth/rbacPolicy.js';
import type { PlatformAdminAuthService } from '../auth/PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId, PlatformAdminStepUpId } from '../auth/types.js';
import type { ComplimentaryEntitlementService } from '../../entitlements/complimentary/ComplimentaryEntitlementService.js';
import type {
  ComplimentaryEntitlementType,
  ComplimentaryGrantCategory,
  ComplimentaryGrantRecord,
  OpaqueFamilyId,
} from '../../entitlements/complimentary/types.js';

export interface PlatformAdminComplimentaryActor {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
  sessionId: PlatformAdminSessionId;
}

export type PlatformAdminComplimentaryErrorCode = 'FORBIDDEN' | 'STEP_UP_REQUIRED';

export class PlatformAdminComplimentaryError extends Error {
  readonly code: PlatformAdminComplimentaryErrorCode;
  constructor(code: PlatformAdminComplimentaryErrorCode) {
    super(`Platform Administration complimentary-grant operation denied: ${code}`);
    this.name = 'PlatformAdminComplimentaryError';
    this.code = code;
  }
}

/**
 * PCA-ADD-COMP-014: Section 8's "support-safe status" restriction for
 * SUPPORT_ADMIN -- category and internalNote are redacted to null on every
 * read this role performs. This is applied at the SERVICE layer (not
 * merely hidden in the UI), so a SUPPORT_ADMIN-authenticated caller can
 * never retrieve those two fields via this route surface no matter what
 * client they use.
 */
export interface ComplimentaryGrantView {
  grantId: string;
  familyId: string;
  entitlementType: ComplimentaryEntitlementType;
  category: ComplimentaryGrantCategory | null;
  amountOrAllowance: number;
  effectiveFrom: Date;
  expiresAt: Date | null;
  status: ComplimentaryGrantRecord['status'];
  reasonCode: string;
  internalNote: string | null;
  grantedByAdminId: string;
  createdAt: Date;
  revokedAt: Date | null;
  revokedByAdminId: string | null;
  revision: number;
}

function toView(record: ComplimentaryGrantRecord, redactSupportSensitive: boolean): ComplimentaryGrantView {
  return {
    grantId: record.grantId,
    familyId: record.familyId,
    entitlementType: record.entitlementType,
    category: redactSupportSensitive ? null : record.category,
    amountOrAllowance: record.amountOrAllowance,
    effectiveFrom: record.effectiveFrom,
    expiresAt: record.expiresAt,
    status: record.status,
    reasonCode: record.reasonCode,
    internalNote: redactSupportSensitive ? null : record.internalNote,
    grantedByAdminId: record.grantedByAdminId,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    revokedByAdminId: record.revokedByAdminId,
    revision: record.revision,
  };
}

export interface CreateComplimentaryGrantRequest {
  familyId: OpaqueFamilyId;
  entitlementType: ComplimentaryEntitlementType;
  category: ComplimentaryGrantCategory;
  amountOrAllowance: number;
  effectiveFrom: Date;
  expiresAt: Date | null;
  reasonCode: string;
  internalNote: string | null;
  stepUpId: PlatformAdminStepUpId;
}

/**
 * Platform-Administration-facing service: composes (never duplicates) the
 * plain `ComplimentaryEntitlementService`, adding RBAC (PCA-ADD-COMP-014),
 * step-up (PCA-ADD-COMP-015, `COMPLIMENTARY_GRANT_MUTATION`), and the
 * SUPPORT_ADMIN read redaction above. Mirrors
 * `PlatformAdminEntitlementService`'s composition pattern exactly.
 */
export class PlatformAdminComplimentaryGrantService {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly entitlementService: ComplimentaryEntitlementService,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private requireRead(actor: PlatformAdminComplimentaryActor): void {
    // PCA-ADD-COMP-014: read is open to all five roles (VIEW_SUPPORT_ACCOUNT_METADATA is ALLOW for all five in rbacPolicy.ts's matrix).
    if (authorizePlatformAdminOperation(actor.roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') throw new PlatformAdminComplimentaryError('FORBIDDEN');
  }

  private requireMutate(actor: PlatformAdminComplimentaryActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'ADMINISTER_COMPLIMENTARY_GRANT') !== 'ALLOW') throw new PlatformAdminComplimentaryError('FORBIDDEN');
  }

  private requirePermanentMutate(actor: PlatformAdminComplimentaryActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'ADMINISTER_COMPLIMENTARY_GRANT_PERMANENT') !== 'ALLOW') throw new PlatformAdminComplimentaryError('FORBIDDEN');
  }

  private isSupportRedacted(actor: PlatformAdminComplimentaryActor): boolean {
    // PCA-ADD-COMP-014 Section 8: SUPPORT_ADMIN sees support-safe status
    // only, never category/internal-note, EVEN IF the admin also happens
    // to hold another role that alone would permit fuller visibility --
    // any admin whose role set includes SUPPORT_ADMIN and nothing more
    // permissive is treated as support-scoped. An admin who ALSO holds
    // APP_OWNER/PLATFORM_ADMIN/FINANCE_ADMIN/AUDITOR_READ_ONLY is not
    // redacted (multi-role admins get the union of their roles'
    // visibility, matching authorizePlatformAdminOperation's "ALLOW if ANY
    // role allows" semantics elsewhere in this codebase).
    const hasBroaderRole = actor.roles.some((role) => role !== 'SUPPORT_ADMIN');
    return actor.roles.includes('SUPPORT_ADMIN') && !hasBroaderRole;
  }

  async listForFamily(actor: PlatformAdminComplimentaryActor, familyId: OpaqueFamilyId): Promise<ComplimentaryGrantView[]> {
    this.requireRead(actor);
    const records = await this.entitlementService.listForFamily(familyId, this.now());
    const redact = this.isSupportRedacted(actor);
    return records.map((r) => toView(r, redact));
  }

  async createGrant(actor: PlatformAdminComplimentaryActor, request: CreateComplimentaryGrantRequest): Promise<ComplimentaryGrantView> {
    this.requireMutate(actor);
    const isPermanent = request.expiresAt === null;
    if (isPermanent) this.requirePermanentMutate(actor);
    await this.authService.consumeStepUp(request.stepUpId, actor.adminId, actor.sessionId, 'COMPLIMENTARY_GRANT_MUTATION');
    const record = await this.entitlementService.createGrant(
      {
        familyId: request.familyId,
        entitlementType: request.entitlementType,
        category: request.category,
        amountOrAllowance: request.amountOrAllowance,
        effectiveFrom: request.effectiveFrom,
        expiresAt: request.expiresAt,
        reasonCode: request.reasonCode,
        internalNote: request.internalNote,
        grantedByAdminId: actor.adminId,
      },
      this.now(),
    );
    return toView(record, this.isSupportRedacted(actor));
  }

  async revokeGrant(actor: PlatformAdminComplimentaryActor, grantId: string, reasonCode: string, stepUpId: PlatformAdminStepUpId): Promise<ComplimentaryGrantView> {
    this.requireMutate(actor);
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'COMPLIMENTARY_GRANT_MUTATION');
    const record = await this.entitlementService.revokeGrant(grantId, actor.adminId, reasonCode, this.now());
    return toView(record, this.isSupportRedacted(actor));
  }

  async renewGrant(actor: PlatformAdminComplimentaryActor, grantId: string, newExpiresAt: Date | null, stepUpId: PlatformAdminStepUpId): Promise<ComplimentaryGrantView> {
    this.requireMutate(actor);
    // Renewing INTO a permanent state (no expiry) is exactly as sensitive
    // as CREATING a permanent grant -- same APP_OWNER-only gate
    // (PCA-ADD-COMP-014's "the only role that may issue LIFETIME_COMPLIMENTARY/
    // permanent grants by default" extends to a renewal that produces that
    // same end state, not only to the initial create call).
    if (newExpiresAt === null) this.requirePermanentMutate(actor);
    await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'COMPLIMENTARY_GRANT_MUTATION');
    const record = await this.entitlementService.renewGrant(grantId, newExpiresAt, this.now());
    return toView(record, this.isSupportRedacted(actor));
  }
}
