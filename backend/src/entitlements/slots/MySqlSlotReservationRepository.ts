import { randomUUID } from 'node:crypto';
import { execute, runInTransaction } from '../../db/pool.js';
import type { ComplimentaryGrantRepository } from '../complimentary/ComplimentaryGrantRepository.js';
import { computeEffectiveEntitlementSnapshot } from '../complimentary/EffectiveEntitlementCapacity.js';
import type { EntitlementRepository } from '../EntitlementRepository.js';
import type { ConsumeOutcome, ReleaseOutcome, ReserveOutcome, SlotReservationRepository } from './SlotReservationRepository.js';
import type { OpaqueFamilyId, SlotReleaseReason, SlotReservationRecord, SlotReservationStatus } from '../types.js';

interface ReservationRow {
  reservation_id: string;
  family_id: string;
  invitation_id: string;
  status: SlotReservationStatus;
  created_at: Date;
  expires_at: Date;
  consumed_at: Date | null;
  released_at: Date | null;
  release_reason: SlotReleaseReason | null;
}

function mapRow(row: ReservationRow): SlotReservationRecord {
  return {
    reservationId: row.reservation_id,
    familyId: row.family_id,
    invitationId: row.invitation_id,
    status: row.status,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
  };
}

export class MySqlSlotReservationRepository implements SlotReservationRepository {
  private readonly entitlementRepository: EntitlementRepository;
  /**
   * EFFECTIVE_ENTITLEMENT_V2 (PCA-COMPLIMENTARY-CONSUMPTION-1, Writer60
   * Round6): optional so the existing `new MySqlSlotReservationRepository
   * (entitlementRepository)` single-arg call site (main.ts) keeps
   * compiling unchanged -- when absent, `reserve` degrades byte-for-byte
   * to the pre-Round6 base-limit-only availability check (zero
   * regression). Wiring a real `ComplimentaryGrantRepository` here
   * (Coordinator follow-up -- see WRITER60 final report's
   * INTERFACE_CHANGE_REQUEST) is what actually closes the consumption-side
   * gap in production.
   */
  private readonly complimentaryGrantRepository: ComplimentaryGrantRepository | null;

  constructor(entitlementRepository: EntitlementRepository, complimentaryGrantRepository?: ComplimentaryGrantRepository) {
    this.entitlementRepository = entitlementRepository;
    this.complimentaryGrantRepository = complimentaryGrantRepository ?? null;
  }

  /**
   * PCA-ADD-PA-038: the family's account_entitlements row is locked with
   * SELECT ... FOR UPDATE (via EntitlementRepository.lockForFamily) BEFORE
   * the availability check, and the reserved-count increment + reservation
   * INSERT happen on that same locked connection within the same
   * transaction. A concurrent reserve() for the same family blocks on the
   * InnoDB row lock until this transaction commits or rolls back -- there
   * is no window where two concurrent callers both observe
   * "reserved + active < limit" as true for the same last slot. Different
   * families' reservations never contend with each other (each locks only
   * its own row).
   *
   * Lazily reconciles any expired reservations for this family first (this
   * codebase's established lazy-expiry idiom -- see
   * InvitationService.effectiveStatus -- rather than a cron job), so a
   * long-abandoned reservation cannot indefinitely starve capacity.
   */
  async reserve(familyId: OpaqueFamilyId, invitationId: string, now: Date, expiresAt: Date): Promise<ReserveOutcome> {
    await this.reconcileExpiredForFamily(familyId, now);
    return runInTransaction(async (conn) => {
      const existing = await execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE invitation_id = ?`, [invitationId]);
      if (existing.rows[0]) {
        return { outcome: 'ALREADY_RESERVED_FOR_INVITATION', record: mapRow(existing.rows[0]) } as const;
      }

      const entitlement = await this.entitlementRepository.lockForFamily(conn, familyId);
      if (!entitlement) return { outcome: 'ENTITLEMENT_NOT_FOUND' } as const;

      // EFFECTIVE_ENTITLEMENT_V2: capacity is base + any ACTIVE,
      // currently-effective complimentary MANAGED_DEVICE_CAPACITY grant,
      // read via the SAME SSOT function every other consumption decision
      // uses (EffectiveEntitlementCapacity.computeEffectiveEntitlementSnapshot),
      // on THIS SAME connection -- already inside the transaction that
      // just took the account_entitlements row's SELECT ... FOR UPDATE
      // lock above, so this never opens a second lock/transaction and
      // never regresses the existing count-then-insert-safe arbitration.
      const effectiveManagedDeviceLimit = this.complimentaryGrantRepository
        ? (
            await computeEffectiveEntitlementSnapshot(
              conn,
              this.complimentaryGrantRepository,
              familyId,
              {
                parentMemberLimit: entitlement.parentMemberLimit,
                managedDeviceLimit: entitlement.managedDeviceLimit,
                parentMemberUsed: entitlement.parentMemberUsedCount,
                managedDeviceActive: entitlement.managedDeviceActiveCount,
                managedDeviceReserved: entitlement.managedDeviceReservedCount,
              },
              now,
            )
          ).effectiveManagedDeviceLimit
        : entitlement.managedDeviceLimit;

      const available = effectiveManagedDeviceLimit - entitlement.managedDeviceActiveCount - entitlement.managedDeviceReservedCount;
      if (available <= 0) return { outcome: 'NO_AVAILABLE_SLOT' } as const;

      await this.entitlementRepository.adjustManagedDeviceCounts(conn, familyId, 1, 0, now);
      const reservationId = randomUUID();
      await execute(
        conn,
        `INSERT INTO managed_device_slot_reservations (reservation_id, family_id, invitation_id, status, created_at, expires_at, consumed_at, released_at, release_reason)
         VALUES (?, ?, ?, 'RESERVED', ?, ?, NULL, NULL, NULL)`,
        [reservationId, familyId, invitationId, now, expiresAt],
      );
      const { rows } = await execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE reservation_id = ?`, [reservationId]);
      return { outcome: 'RESERVED', record: mapRow(rows[0]!) } as const;
    });
  }

  /** Idempotent: releasing an already-RELEASED or already-CONSUMED reservation is a stable no-op, never a double-decrement. */
  async releaseByInvitationId(invitationId: string, reason: SlotReleaseReason, now: Date): Promise<ReleaseOutcome> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE invitation_id = ? FOR UPDATE`, [invitationId]);
      const row = rows[0];
      if (!row) return { outcome: 'NOT_FOUND' } as const;
      if (row.status === 'RELEASED') return { outcome: 'ALREADY_RELEASED' } as const;
      if (row.status === 'CONSUMED') return { outcome: 'ALREADY_CONSUMED' } as const;

      const updated = await execute(
        conn,
        `UPDATE managed_device_slot_reservations SET status = 'RELEASED', released_at = ?, release_reason = ? WHERE reservation_id = ? AND status = 'RESERVED'`,
        [now, reason, row.reservation_id],
      );
      if (updated.rowCount === 0) return { outcome: 'ALREADY_RELEASED' } as const;
      await this.entitlementRepository.lockForFamily(conn, row.family_id);
      await this.entitlementRepository.adjustManagedDeviceCounts(conn, row.family_id, -1, 0, now);
      return { outcome: 'RELEASED' } as const;
    });
  }

  /**
   * PCA-ADD-PA-036 stage 4 (RESERVED -> CONSUMED). Defined and correct, but
   * intentionally unwired to any caller in this codebase today -- doc 08's
   * PAIRED -> ACTIVE ("first policy delivered/applied" via the Family Trust
   * Set) transition does not exist anywhere in backend/src (confirmed by
   * repository survey), so nothing in this lane fabricates a call to this
   * method from a state that does not represent genuine device activation.
   * See the PCA-PA-2 final report.
   */
  async consumeByInvitationId(invitationId: string, now: Date): Promise<ConsumeOutcome> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE invitation_id = ? FOR UPDATE`, [invitationId]);
      const row = rows[0];
      if (!row) return { outcome: 'NOT_FOUND' } as const;
      if (row.status === 'CONSUMED') return { outcome: 'ALREADY_CONSUMED' } as const;
      if (row.status !== 'RESERVED') return { outcome: 'INVALID_STATE' } as const;

      const updated = await execute(
        conn,
        `UPDATE managed_device_slot_reservations SET status = 'CONSUMED', consumed_at = ? WHERE reservation_id = ? AND status = 'RESERVED'`,
        [now, row.reservation_id],
      );
      if (updated.rowCount === 0) return { outcome: 'ALREADY_CONSUMED' } as const;
      await this.entitlementRepository.lockForFamily(conn, row.family_id);
      await this.entitlementRepository.adjustManagedDeviceCounts(conn, row.family_id, -1, 1, now);
      return { outcome: 'CONSUMED' } as const;
    });
  }

  async reconcileExpiredForFamily(familyId: OpaqueFamilyId, now: Date): Promise<number> {
    return runInTransaction(async (conn) => {
      const { rows } = await execute<ReservationRow>(
        conn,
        `SELECT * FROM managed_device_slot_reservations WHERE family_id = ? AND status = 'RESERVED' AND expires_at <= ? FOR UPDATE`,
        [familyId, now],
      );
      if (rows.length === 0) return 0;
      for (const row of rows) {
        await execute(
          conn,
          `UPDATE managed_device_slot_reservations SET status = 'RELEASED', released_at = ?, release_reason = 'EXPIRED' WHERE reservation_id = ? AND status = 'RESERVED'`,
          [now, row.reservation_id],
        );
      }
      const entitlement = await this.entitlementRepository.lockForFamily(conn, familyId);
      if (entitlement) {
        await this.entitlementRepository.adjustManagedDeviceCounts(conn, familyId, -rows.length, 0, now);
      }
      return rows.length;
    });
  }

  async findByInvitationId(invitationId: string): Promise<SlotReservationRecord | null> {
    const { rows } = await runInTransaction((conn) => execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE invitation_id = ?`, [invitationId]));
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async listForFamily(familyId: OpaqueFamilyId): Promise<SlotReservationRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<ReservationRow>(conn, `SELECT * FROM managed_device_slot_reservations WHERE family_id = ? ORDER BY created_at DESC`, [familyId]),
    );
    return rows.map(mapRow);
  }
}
