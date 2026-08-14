/**
 * PCA-COMMERCIAL-NOTIFY-1 -- family-scoped read API (mission Section 6:
 * list, unread count, mark read/acknowledge). This service performs NO
 * authorization of its own -- exactly like PairingService/InvitationService
 * (see http/requireFamilyAuthorization.ts's header) -- it trusts the HTTP
 * route already proved "this service session holds an ACTIVE family scope
 * for this familyId" via AuthzService before ever calling here, and takes
 * `accountRef` (== the family's opaque id, mirroring
 * billing/checkout/CheckoutService.ts's `accountRef: input.familyId`
 * convention) as a plain scoping parameter every query is bound to.
 */

import { runInTransaction } from '../db/pool.js';
import { CommercialNotificationRepository } from './CommercialNotificationRepository.js';
import type { CommercialNotificationRow, CommercialNotificationSupportRow } from './types.js';

export type MarkReadOutcome = 'MARKED' | 'NOT_FOUND';
export type AcknowledgeOutcome = 'ACKNOWLEDGED' | 'NOT_FOUND';

export class CommercialNotificationService {
  constructor(private readonly repository: CommercialNotificationRepository) {}

  async list(accountRef: string, limit?: number): Promise<CommercialNotificationRow[]> {
    return this.repository.listByAccount(accountRef, limit);
  }

  async unreadCount(accountRef: string): Promise<number> {
    return this.repository.countUnread(accountRef);
  }

  /** NOT_FOUND covers both "no such notification" and "exists but belongs to a different account" -- the caller never learns which, so this endpoint cannot be used to probe another family's notification ids. */
  async markRead(notificationId: string, accountRef: string, now: Date = new Date()): Promise<MarkReadOutcome> {
    const marked = await runInTransaction((conn) => this.repository.markRead(conn, notificationId, accountRef, now));
    if (marked) return 'MARKED';
    // Distinguish "already read" (still a success) from "not owned/doesn't exist" without a second round trip's TOCTOU gap mattering: markRead only fails to affect a row when either the row is missing/not-owned, or it was already read. Re-check ownership+read state to tell those apart.
    const existing = await runInTransaction((conn) => this.repository.findReadRowScopedToAccount(conn, notificationId, accountRef));
    return existing ? 'MARKED' : 'NOT_FOUND';
  }

  async acknowledge(notificationId: string, accountRef: string, now: Date = new Date()): Promise<AcknowledgeOutcome> {
    const acknowledged = await runInTransaction((conn) => this.repository.acknowledge(conn, notificationId, accountRef, now));
    if (acknowledged) return 'ACKNOWLEDGED';
    const existing = await runInTransaction((conn) => this.repository.findReadRowScopedToAccount(conn, notificationId, accountRef));
    return existing && existing.acknowledgedAt !== null ? 'ACKNOWLEDGED' : 'NOT_FOUND';
  }
}

/** Section 7 Platform Support View -- a distinct, narrower service so a route can never accidentally reach family message content through it (no method here returns messageKey/params). */
export class CommercialNotificationSupportService {
  constructor(private readonly repository: CommercialNotificationRepository) {}

  async listForSupport(accountRef: string, limit?: number): Promise<CommercialNotificationSupportRow[]> {
    return this.repository.listForSupport(accountRef, limit);
  }
}
