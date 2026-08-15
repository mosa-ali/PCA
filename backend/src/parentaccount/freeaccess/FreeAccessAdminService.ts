import { randomUUID } from 'node:crypto';
import type { PoolConnection } from 'mysql2/promise';
import { runInTransaction as realRunInTransaction } from '../../db/pool.js';
import { authorizePlatformAdminOperation } from '../../platformadmin/auth/rbacPolicy.js';
import { PlatformAdminAuthError } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import type { PlatformAdminAuthService } from '../../platformadmin/auth/PlatformAdminAuthService.js';
import type { PlatformAdminId, PlatformAdminRole, PlatformAdminSessionId, PlatformAdminStepUpId } from '../../platformadmin/auth/types.js';
import { insertPlatformAdminAuditEventRow as realInsertAuditEventRow } from '../../platformadmin/audit/MySqlPlatformAdminAuditRepository.js';
import type { PlatformAdminAuditEvent } from '../../platformadmin/audit/types.js';
import { resolveFreeAccessDefaults } from '../policy.js';
import type { FreeAccessDefaults } from '../policy.js';
import type { ParentAccountId } from '../types.js';
import { deriveFreeAccessStatus } from './deriveFreeAccessStatus.js';
import { FreeAccessAdjustmentError } from './adjustment.js';
import type { FreeAccessAdjustmentAction } from './adjustment.js';
import type { FreeAccessAccountRepository } from './FreeAccessAccountRepository.js';
import type { FreeAccessStatus } from './types.js';

export interface FreeAccessAdminActor {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
  sessionId: PlatformAdminSessionId;
}

export type FreeAccessAdminErrorCode = 'FORBIDDEN' | 'STEP_UP_REQUIRED' | 'NOT_FOUND' | 'INVALID_REQUEST';

export class FreeAccessAdminError extends Error {
  readonly code: FreeAccessAdminErrorCode;
  constructor(code: FreeAccessAdminErrorCode) {
    super(`Platform Administration FREE_ACCESS operation denied: ${code}`);
    this.name = 'FreeAccessAdminError';
    this.code = code;
  }
}

const REASON_CODE_MAX_LENGTH = 200;

/**
 * PCA-DEC-026/FREE_ACCESS_ENFORCEMENT_V1's Platform Administration surface.
 * Deliberately reuses EXISTING RBAC operations/step-up scopes rather than
 * adding new ones -- `rbacPolicy.ts` and
 * `platformadmin/auth/types.ts`'s `PLATFORM_ADMIN_STEP_UP_SCOPES` are not
 * this lane's files to edit this round (see this lane's final report for
 * the exact ownership citation):
 *  - VIEW: `VIEW_SUPPORT_ACCOUNT_METADATA` (ALLOW for all five roles,
 *    identical to every other read-only Platform Administration surface).
 *  - MUTATE (existing-account adjustment): `ADMINISTER_ENTITLEMENT_QUANTITY`
 *    (APP_OWNER/PLATFORM_ADMIN only) -- the same operation
 *    `settingsRoutes.ts`'s FREE_STARTER-defaults mutation reuses for a
 *    structurally identical "adjust a default/account-level access
 *    quantity" action.
 *  - STEP_UP (existing-account adjustment only): `ENTITLEMENT_LIMIT_OVERRIDE`
 *    -- an admin overriding one specific account's snapshotted access is
 *    the same sensitivity class that scope already gates for device-limit
 *    overrides.
 * The GLOBAL default view is read-only this round (no step-up, matching
 * `settingsRoutes.ts`'s free-starter-defaults GET) -- see this lane's
 * final report for why a real persisted (not just env-var) mutation
 * surface is an explicitly named gap, not shipped this round.
 */
export class FreeAccessAdminService {
  constructor(
    private readonly authService: PlatformAdminAuthService,
    private readonly repository: FreeAccessAccountRepository,
    private readonly now: () => Date = () => new Date(),
    /**
     * Injected so tests can exercise this service's full RBAC/step-up/
     * validation/audit-shape logic without a real MySQL connection --
     * production (Coordinator-wired) always gets the real db/pool.js
     * transaction runner; a test harness supplies a synchronous passthrough
     * (`(fn) => fn(fakeConn)`) paired with a fake repository/auditWriter
     * that both ignore the connection argument. Mirrors the same
     * injectable-clock discipline `now` above already establishes.
     */
    private readonly runInTransaction: <T>(fn: (conn: PoolConnection) => Promise<T>) => Promise<T> = realRunInTransaction,
    private readonly writeAuditEvent: (conn: PoolConnection, event: PlatformAdminAuditEvent) => Promise<void> = realInsertAuditEventRow,
  ) {}

  private requireView(actor: FreeAccessAdminActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'VIEW_SUPPORT_ACCOUNT_METADATA') !== 'ALLOW') throw new FreeAccessAdminError('FORBIDDEN');
  }

  private requireMutate(actor: FreeAccessAdminActor): void {
    if (authorizePlatformAdminOperation(actor.roles, 'ADMINISTER_ENTITLEMENT_QUANTITY') !== 'ALLOW') throw new FreeAccessAdminError('FORBIDDEN');
  }

  /**
   * Read-only. `PCA_FREE_ACCESS_*`/`PCA_DEFAULT_*` env vars remain the
   * prospective-only source of truth for NEWLY verified accounts, exactly
   * as Round5 shipped them (`resolveFreeAccessDefaults`, unmodified) --
   * this method makes that existing config actually VISIBLE to Platform
   * Administration (Round5 shipped none), closing part of the "extends
   * Round5's env-var-only config with a real admin surface" mission gap.
   * Changing these values (a real, persisted, admin-editable mutation
   * surface) is an explicitly reported gap this round -- see the final
   * report's INTERFACE_CHANGE_REQUEST for the proposed schema.
   */
  getGlobalDefaults(actor: FreeAccessAdminActor): FreeAccessDefaults {
    this.requireView(actor);
    return resolveFreeAccessDefaults();
  }

  /** Read-only. 404s (via FreeAccessAdminError('NOT_FOUND')) for an unknown/never-verified account -- never a silent empty response. */
  async getAccountStatus(actor: FreeAccessAdminActor, accountId: ParentAccountId): Promise<FreeAccessStatus> {
    this.requireView(actor);
    const row = await this.repository.findByAccountId(accountId);
    if (!row || row.freeAccess === null) throw new FreeAccessAdminError('NOT_FOUND');
    return deriveFreeAccessStatus(row.freeAccess, this.now());
  }

  /**
   * Explicit, audited adjustment of an ALREADY-REGISTERED account's
   * FreeAccessSnapshot (extend/reduce/convert). Requires reason, step-up,
   * and always writes a before/after audit event in the SAME transaction
   * as the mutation -- never a best-effort separate audit call. This
   * method (and the account it targets) is entirely independent of
   * `getGlobalDefaults` above: calling this never reads or is triggered by
   * a global default change, and a global default change never calls
   * this -- the two paths do not share write logic, which is what
   * guarantees "changing the GLOBAL default never silently mutates an
   * already-registered account's own snapshot" structurally, not just by
   * convention.
   */
  async adjustAccount(
    actor: FreeAccessAdminActor,
    accountId: ParentAccountId,
    action: FreeAccessAdjustmentAction,
    reasonCode: string,
    stepUpId: PlatformAdminStepUpId,
  ): Promise<FreeAccessStatus> {
    this.requireMutate(actor);
    if (typeof reasonCode !== 'string' || reasonCode.length === 0 || reasonCode.length > REASON_CODE_MAX_LENGTH) {
      throw new FreeAccessAdminError('INVALID_REQUEST');
    }
    try {
      await this.authService.consumeStepUp(stepUpId, actor.adminId, actor.sessionId, 'ENTITLEMENT_LIMIT_OVERRIDE');
    } catch (error) {
      if (error instanceof PlatformAdminAuthError) throw new FreeAccessAdminError('STEP_UP_REQUIRED');
      throw error;
    }

    const now = this.now();
    let result;
    try {
      result = await this.runInTransaction(async (conn) => {
        const adjustment = await this.repository.adjustFreeAccessWithinTransaction(conn, accountId, action, now);
        if (!adjustment) return null;
        await this.writeAuditEvent(conn, {
          eventId: randomUUID(),
          eventType: 'SETTING_CHANGED',
          actorAdminId: actor.adminId,
          actorRole: actor.roles[0] ?? null,
          targetRef: `parent_account_free_access:${accountId}`,
          result: 'SUCCESS',
          occurredAt: now,
          correlationId: randomUUID(),
          metadata: {
            domain: 'FREE_ACCESS_ACCOUNT_ADJUSTMENT',
            action,
            reasonCode,
            before: snapshotToAuditJson(adjustment.before),
            after: snapshotToAuditJson(adjustment.after),
          },
        });
        return adjustment;
      });
    } catch (error) {
      if (error instanceof FreeAccessAdjustmentError) throw new FreeAccessAdminError('INVALID_REQUEST');
      throw error;
    }
    if (!result) throw new FreeAccessAdminError('NOT_FOUND');
    return deriveFreeAccessStatus(result.after, now);
  }
}

function snapshotToAuditJson(snapshot: { mode: string; durationDays: number | null; expiresAt: Date | null }) {
  return { mode: snapshot.mode, durationDays: snapshot.durationDays, expiresAt: snapshot.expiresAt ? snapshot.expiresAt.toISOString() : null };
}
