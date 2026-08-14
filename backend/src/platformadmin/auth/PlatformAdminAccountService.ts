import { randomUUID } from 'node:crypto';
import { isDuplicateEntry } from '../../db/pool.js';
import { hashPassword } from './passwordCredential.js';
import { authorizePlatformAdminOperation } from './rbacPolicy.js';
import type { PlatformAdminAuthRepository } from './AuthRepository.js';
import type { PlatformAdminAccountRecord, PlatformAdminId, PlatformAdminRole } from './types.js';
import type { PlatformAdminAuditEvent } from '../audit/types.js';

export type PlatformAdminAccountErrorCode = 'ACCOUNT_OPERATION_REJECTED';

/**
 * Deliberately ONE generic code/message for every account-management
 * failure mode -- authorization denied, duplicate active role grant,
 * unknown account, account already in the requested state -- mirroring
 * backend/src/auth/AuthService.ts's AuthError pattern faithfully. This
 * domain has no untrusted HTTP surface in this lane (Section 15 of the
 * addendum scopes account-management CRUD out of PCA-PA-1's HTTP surface
 * entirely -- see this lane's final report), but the anti-oracle
 * discipline is applied anyway so a future HTTP surface built directly on
 * this service inherits it for free, rather than having to retrofit it.
 */
export class PlatformAdminAccountError extends Error {
  readonly code: PlatformAdminAccountErrorCode;
  constructor(message = 'Platform Administration account operation was rejected.') {
    super(message);
    this.name = 'PlatformAdminAccountError';
    this.code = 'ACCOUNT_OPERATION_REJECTED';
  }
}

export interface ActingAdmin {
  adminId: PlatformAdminId;
  roles: PlatformAdminRole[];
}

export type Actor = ActingAdmin | 'BOOTSTRAP';

function actorAdminId(actor: Actor): PlatformAdminId | null {
  return actor === 'BOOTSTRAP' ? null : actor.adminId;
}

function actorPrimaryRole(actor: Actor): PlatformAdminRole | null {
  return actor === 'BOOTSTRAP' ? null : (actor.roles[0] ?? null);
}

/**
 * Account/role/status management for Platform Administration accounts.
 * NOT exposed over HTTP in this lane (PCA-PA-1) -- an intentional scope
 * boundary (see this lane's final report): today the only callers are
 * scripts/bootstrap-platform-owner.mjs ('BOOTSTRAP' actor) and this
 * service's own test suite. Every mutating method still calls
 * authorizePlatformAdminOperation itself (defense in depth) even though no
 * HTTP layer exists yet to also gate it -- the addendum requires this
 * layering regardless of whether a second enforcement point currently
 * exists.
 *
 * Every mutating method writes its audit event(s) in the SAME transaction
 * as the mutation (PlatformAdminAuthRepository's methods each open exactly
 * one runInTransaction spanning both) -- an audit write is never a
 * separate, skippable, best-effort call after the fact.
 */
export class PlatformAdminAccountService {
  private readonly repository: PlatformAdminAuthRepository;
  private readonly now: () => Date;

  constructor(repository: PlatformAdminAuthRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  /**
   * MFA is always seeded PENDING_SETUP here -- there is no self-service
   * "complete MFA setup" HTTP endpoint in this lane, so an account created
   * by this method cannot complete login until a future workstream adds
   * one (see this lane's final report's KNOWN_GAPS: the same limitation
   * scripts/bootstrap-platform-owner.mjs documents and deliberately avoids
   * by seeding MFA ACTIVE directly for the bootstrap-created account).
   */
  async createAccount(
    displayName: string,
    emailHash: Buffer,
    password: string,
    role: PlatformAdminRole,
    createdBy: Actor,
  ): Promise<PlatformAdminAccountRecord> {
    if (createdBy !== 'BOOTSTRAP' && authorizePlatformAdminOperation(createdBy.roles, 'MANAGE_ADMIN_ACCOUNTS') !== 'ALLOW') {
      throw new PlatformAdminAccountError();
    }
    const adminId = randomUUID();
    const now = this.now();
    const passwordCredential = await hashPassword(password);
    const correlationId = randomUUID();
    const auditEvents: PlatformAdminAuditEvent[] = [
      {
        eventId: randomUUID(),
        eventType: 'ADMIN_CREATED',
        actorAdminId: actorAdminId(createdBy),
        actorRole: actorPrimaryRole(createdBy),
        targetRef: `admin:${adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId,
        metadata: null,
      },
      {
        eventId: randomUUID(),
        eventType: 'ADMIN_ROLE_CHANGED',
        actorAdminId: actorAdminId(createdBy),
        actorRole: actorPrimaryRole(createdBy),
        targetRef: `admin:${adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId,
        metadata: { action: 'GRANTED', role },
      },
    ];
    try {
      return await this.repository.createAccount({
        adminId,
        emailHash,
        displayName,
        passwordCredential,
        createdAt: now,
        assignmentId: randomUUID(),
        role,
        grantedByAdminId: actorAdminId(createdBy),
        grantedAt: now,
        initialMfa: { status: 'PENDING_SETUP', totpSecretCiphertext: null, totpSecretNonce: null, activatedAt: null, createdAt: now },
        auditEvents,
      });
    } catch (error) {
      if (isDuplicateEntry(error)) throw new PlatformAdminAccountError();
      throw error;
    }
  }

  async assignRole(adminId: PlatformAdminId, role: PlatformAdminRole, actor: Actor): Promise<void> {
    if (actor !== 'BOOTSTRAP' && authorizePlatformAdminOperation(actor.roles, 'ASSIGN_ADMIN_ROLE') !== 'ALLOW') {
      throw new PlatformAdminAccountError();
    }
    const now = this.now();
    try {
      await this.repository.assignRole({
        assignmentId: randomUUID(),
        adminId,
        role,
        grantedAt: now,
        grantedByAdminId: actorAdminId(actor),
        auditEvent: {
          eventId: randomUUID(),
          eventType: 'ADMIN_ROLE_CHANGED',
          actorAdminId: actorAdminId(actor),
          actorRole: actorPrimaryRole(actor),
          targetRef: `admin:${adminId}`,
          result: 'SUCCESS',
          occurredAt: now,
          correlationId: randomUUID(),
          metadata: { action: 'GRANTED', role },
        },
      });
    } catch (error) {
      // Duplicate ACTIVE (admin_id, role) grant -- rejected by the DB
      // unique constraint platform_admin_role_assignments_admin_active_key.
      if (isDuplicateEntry(error)) throw new PlatformAdminAccountError();
      throw error;
    }
  }

  /**
   * Revoking a role that leaves the admin with zero active roles is
   * allowed (a valid "fully disabled" state) -- but MUST cascade to
   * force-revoke every one of that admin's active sessions in the same
   * transaction (PCA-ADD-PA-019). See MySqlPlatformAdminAuthRepository's
   * revokeRole for the transactional cascade.
   */
  async revokeRole(adminId: PlatformAdminId, role: PlatformAdminRole, actor: Actor): Promise<{ revokedSessionCount: number }> {
    if (actor !== 'BOOTSTRAP' && authorizePlatformAdminOperation(actor.roles, 'ASSIGN_ADMIN_ROLE') !== 'ALLOW') {
      throw new PlatformAdminAccountError();
    }
    const now = this.now();
    const result = await this.repository.revokeRole({
      adminId,
      role,
      revokedAt: now,
      auditEvent: {
        eventId: randomUUID(),
        eventType: 'ADMIN_ROLE_CHANGED',
        actorAdminId: actorAdminId(actor),
        actorRole: actorPrimaryRole(actor),
        targetRef: `admin:${adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: { action: 'REVOKED', role },
      },
    });
    return { revokedSessionCount: result.revokedSessionIds.length };
  }

  async disableAccount(adminId: PlatformAdminId, actor: Actor): Promise<{ revokedSessionCount: number }> {
    if (actor !== 'BOOTSTRAP' && authorizePlatformAdminOperation(actor.roles, 'MANAGE_ADMIN_ACCOUNTS') !== 'ALLOW') {
      throw new PlatformAdminAccountError();
    }
    const now = this.now();
    const result = await this.repository.disableAccount({
      adminId,
      disabledAt: now,
      auditEvent: {
        eventId: randomUUID(),
        eventType: 'ACCOUNT_SUSPENDED',
        actorAdminId: actorAdminId(actor),
        actorRole: actorPrimaryRole(actor),
        targetRef: `admin:${adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: null,
      },
    });
    return { revokedSessionCount: result.revokedSessionIds.length };
  }

  async reactivateAccount(adminId: PlatformAdminId, actor: Actor): Promise<void> {
    if (actor !== 'BOOTSTRAP' && authorizePlatformAdminOperation(actor.roles, 'MANAGE_ADMIN_ACCOUNTS') !== 'ALLOW') {
      throw new PlatformAdminAccountError();
    }
    const now = this.now();
    await this.repository.reactivateAccount({
      adminId,
      auditEvent: {
        eventId: randomUUID(),
        eventType: 'ACCOUNT_REACTIVATED',
        actorAdminId: actorAdminId(actor),
        actorRole: actorPrimaryRole(actor),
        targetRef: `admin:${adminId}`,
        result: 'SUCCESS',
        occurredAt: now,
        correlationId: randomUUID(),
        metadata: null,
      },
    });
  }
}
