import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool, isDuplicateEntry, runInTransaction } from '../db/pool.js';
import type {
  ApproveCeremonyOutcome,
  CommitBootstrapInput,
  CommitBootstrapOutcome,
  CreateOrReuseCeremonyInput,
  CreateOrReuseCeremonyOutcome,
  FirstDeviceAttemptContext,
  FirstDeviceBootstrapCeremonyRecord,
  FirstDeviceBootstrapCommitHooks,
  FirstDeviceBootstrapStore,
} from './FirstDeviceBootstrapStore.js';
import { ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE, TRUST_ROOT_PROTOCOL_VERSION } from './FirstDeviceBootstrapProof.js';
import { ensureAndLockFamilyFloors } from './MySqlTrustSetEpochStore.js';
import type { MySqlTrustSetEpochStore } from './MySqlTrustSetEpochStore.js';

/**
 * Wave 6B MySQL ceremony store.
 *
 * Serialization and atomicity model (owner directives D4/F4, §8/§9):
 *  - "Exactly one root per family" is enforced by two durable layers: the
 *    PK on family_authority_genesis_anchors(family_id) as the invariant of
 *    record, and the shared per-family floors FOR UPDATE latch
 *    (ensureAndLockFamilyFloors -- the same latch every epoch append takes)
 *    as the serialization point, so anchor insert + epoch-1 append + floor
 *    moves are one critical section per family.
 *  - The ENTIRE successful bootstrap (challenge consumption = ceremony row
 *    going COMMITTED, anchor insert, epoch-1 append, floors) happens in ONE
 *    transaction: any failure after any write rolls the whole thing back, so
 *    a crash or a failed verification can never leave partial state. The
 *    challenge is therefore consumed exactly on success, and an identical
 *    retry afterwards replays idempotently by payload digest.
 *  - Lock order is fixed: ceremony row -> floors latch. createOrReuse takes
 *    device row -> ceremony row (insert), never touching floors; commit
 *    takes ceremony row -> floors. The two orders can never nest, so no
 *    lock-order inversion exists.
 *  - No private key material or recovery envelope data is ever read or
 *    written by this store (§7): the anchor carries public key material and
 *    signatures only.
 */

const CERTIFICATE_STATES = new Set(['PAIRING_PENDING', 'PAIRED']);

const CEREMONY_COLUMNS = [
  'ceremony_id',
  'family_id',
  'device_id',
  'dsk_key_id',
  'dsk_public_key',
  'dsk_algorithm',
  'purpose',
  'challenge_id',
  'nonce',
  'expires_at',
  'status',
  'approved_by_account_id',
  'approved_at',
  'payload_digest',
  'outcome',
  'consumed_at',
  'created_at',
  'updated_at',
  'bootstrap_proof_sha256',
  'attestation_evidence_sha256',
].join(', ');

interface CeremonyRow extends RowDataPacket {
  ceremony_id: string;
  family_id: string;
  device_id: string;
  dsk_key_id: string;
  dsk_public_key: string;
  dsk_algorithm: string;
  purpose: string;
  challenge_id: string;
  nonce: string;
  expires_at: Date | string;
  status: string;
  approved_by_account_id: string | null;
  approved_at: Date | string | null;
  payload_digest: string | null;
  outcome: string | null;
  consumed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  bootstrap_proof_sha256: string | null;
  attestation_evidence_sha256: string | null;
}

interface AttemptRow extends RowDataPacket {
  attempt_id: string;
  device_id: string;
  family_id: string;
  platform: string;
  recovery_token_hash: string;
  signing_key_id: string;
  signing_public_key: string;
}

interface DeviceRow extends RowDataPacket {
  family_id: string;
  status: string;
}

interface FamilyRow extends RowDataPacket {
  provisioned_for_account_id: string | null;
  status: string;
}

interface AccountRow extends RowDataPacket {
  status: string;
  disabled_at: Date | string | null;
  service_account_id: string;
}

interface MembershipRow extends RowDataPacket {
  role: string;
  service_account_id: string;
}

interface AnchorRow extends RowDataPacket {
  family_id: string;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toNullableDate(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function toCeremonyRecord(row: CeremonyRow): FirstDeviceBootstrapCeremonyRecord {
  return {
    ceremonyId: row.ceremony_id,
    familyId: row.family_id,
    deviceId: row.device_id,
    dskKeyId: row.dsk_key_id,
    dskPublicKey: row.dsk_public_key,
    dskAlgorithm: row.dsk_algorithm,
    purpose: row.purpose,
    challengeId: row.challenge_id,
    nonce: row.nonce,
    expiresAt: toDate(row.expires_at),
    status: row.status as FirstDeviceBootstrapCeremonyRecord['status'],
    approvedByAccountId: row.approved_by_account_id,
    approvedAt: toNullableDate(row.approved_at),
    payloadDigest: row.payload_digest,
    outcome: row.outcome,
    consumedAt: toNullableDate(row.consumed_at),
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    bootstrapProofSha256: row.bootstrap_proof_sha256,
    attestationEvidenceSha256: row.attestation_evidence_sha256,
  };
}

/** Internal marker: the shared epoch append refused; forces a full rollback of the commit transaction. */
class EpochAppendRefusedError extends Error {
  constructor(readonly appendOutcome: string) {
    super(`epoch append refused: ${appendOutcome}`);
    this.name = 'EpochAppendRefusedError';
  }
}

export interface MySqlFirstDeviceBootstrapStoreDeps {
  /** The shared epoch store, so anchor + epoch-1 + floors commit through the same per-family serialization. */
  epochStore: Pick<MySqlTrustSetEpochStore, 'appendAcceptedEpochOnConnection'>;
  /** Test-only seam; never wired in production. */
  commitHooks?: FirstDeviceBootstrapCommitHooks;
}

export class MySqlFirstDeviceBootstrapStore implements FirstDeviceBootstrapStore {
  private readonly epochStore: Pick<MySqlTrustSetEpochStore, 'appendAcceptedEpochOnConnection'>;
  private readonly commitHooks: FirstDeviceBootstrapCommitHooks | undefined;

  constructor(deps: MySqlFirstDeviceBootstrapStoreDeps) {
    this.epochStore = deps.epochStore;
    this.commitHooks = deps.commitHooks;
  }

  async readAttemptContext(attemptId: string): Promise<FirstDeviceAttemptContext | null> {
    const [rows] = await getPool().query<AttemptRow[]>(
      `SELECT a.attempt_id, a.device_id, a.family_id, a.platform, a.recovery_token_hash, a.signing_key_id, a.signing_public_key
         FROM enrollment_bootstrap_attempts a
        WHERE a.attempt_id = ?`,
      [attemptId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      attemptId: row.attempt_id,
      deviceId: row.device_id,
      familyId: row.family_id,
      platform: row.platform === 'IOS' ? 'IOS' : 'ANDROID',
      recoveryTokenHash: row.recovery_token_hash,
      signingKeyId: row.signing_key_id,
      signingPublicKey: row.signing_public_key,
    };
  }

  async readCeremony(ceremonyId: string): Promise<FirstDeviceBootstrapCeremonyRecord | null> {
    return runInTransaction(async (conn) => {
      const [rows] = await conn.execute<CeremonyRow[]>(
        `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ?`,
        [ceremonyId],
      );
      const row = rows[0];
      return row ? toCeremonyRecord(row) : null;
    });
  }

  async readOwnerEligibility(familyId: string, accountId: string): Promise<boolean> {
    return runInTransaction((conn) => this.isOwnerEligibleOn(conn, familyId, accountId));
  }

  async createOrReuseCeremony(input: CreateOrReuseCeremonyInput): Promise<CreateOrReuseCeremonyOutcome> {
    return runInTransaction(async (conn) => {
      // Lock the device row so concurrent challenge requests for one device serialize on ceremony creation.
      const [deviceRows] = await conn.execute<DeviceRow[]>(
        'SELECT family_id, status FROM devices WHERE device_id = ? FOR UPDATE',
        [input.deviceId],
      );
      const device = deviceRows[0];
      if (!device || device.family_id !== input.familyId || !CERTIFICATE_STATES.has(device.status)) {
        return { outcome: 'DEVICE_NOT_ELIGIBLE' };
      }

      const [existingRows] = await conn.execute<CeremonyRow[]>(
        `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies
          WHERE device_id = ? AND status IN ('PENDING', 'APPROVED')
          ORDER BY created_at DESC LIMIT 1`,
        [input.deviceId],
      );
      const existing = existingRows[0];
      if (existing && toDate(existing.expires_at).getTime() > input.now.getTime()) {
        const sameClaim =
          existing.family_id === input.familyId &&
          existing.dsk_key_id === input.dskKeyId &&
          existing.dsk_public_key === input.dskPublicKey;
        return sameClaim ? { outcome: 'REUSED', ceremony: toCeremonyRecord(existing) } : { outcome: 'CONFLICT' };
      }

      const ceremonyId = randomUUID();
      await conn.execute(
        `INSERT INTO family_first_device_bootstrap_ceremonies
           (ceremony_id, family_id, device_id, dsk_key_id, dsk_public_key, dsk_algorithm, purpose,
            challenge_id, nonce, expires_at, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
        [
          ceremonyId,
          input.familyId,
          input.deviceId,
          input.dskKeyId,
          input.dskPublicKey,
          input.dskAlgorithm,
          input.purpose,
          input.challengeId,
          input.nonce,
          input.expiresAt,
          input.now,
          input.now,
        ],
      );
      const [rows] = await conn.execute<CeremonyRow[]>(
        `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ?`,
        [ceremonyId],
      );
      return { outcome: 'CREATED', ceremony: toCeremonyRecord(rows[0]) };
    });
  }

  async approveCeremony(input: {
    ceremonyId: string;
    accountId: string;
    familyId: string;
    now: Date;
  }): Promise<ApproveCeremonyOutcome> {
    return runInTransaction(async (conn) => {
      const [rows] = await conn.execute<CeremonyRow[]>(
        `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ? FOR UPDATE`,
        [input.ceremonyId],
      );
      const row = rows[0];
      // Family-scoped: a cross-family ceremony id is indistinguishable from a missing one.
      if (!row || row.family_id !== input.familyId) return { outcome: 'NOT_FOUND' };
      if (row.status !== 'PENDING') return { outcome: 'NOT_PENDING' };
      if (toDate(row.expires_at).getTime() <= input.now.getTime()) return { outcome: 'EXPIRED' };
      if (!(await this.isOwnerEligibleOn(conn, input.familyId, input.accountId))) {
        return { outcome: 'NOT_ELIGIBLE' };
      }

      const [update] = await conn.execute<ResultSetHeader>(
        `UPDATE family_first_device_bootstrap_ceremonies
            SET status = 'APPROVED', approved_by_account_id = ?, approved_at = ?, updated_at = ?
          WHERE ceremony_id = ? AND status = 'PENDING' AND expires_at > ?`,
        [input.accountId, input.now, input.now, input.ceremonyId, input.now],
      );
      if (update.affectedRows !== 1) return { outcome: 'NOT_PENDING' };

      const [updatedRows] = await conn.execute<CeremonyRow[]>(
        `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ?`,
        [input.ceremonyId],
      );
      return { outcome: 'APPROVED', ceremony: toCeremonyRecord(updatedRows[0]) };
    });
  }

  async commitBootstrap(input: CommitBootstrapInput): Promise<CommitBootstrapOutcome> {
    try {
      return await runInTransaction(async (conn) => {
        // ---- 1. Lock the ceremony row: the one-time challenge serialization point ----
        const [rows] = await conn.execute<CeremonyRow[]>(
          `SELECT ${CEREMONY_COLUMNS} FROM family_first_device_bootstrap_ceremonies WHERE ceremony_id = ? FOR UPDATE`,
          [input.ceremonyId],
        );
        const row = rows[0];
        if (!row) return { outcome: 'CEREMONY_NOT_FOUND' };

        // ---- 2. Replay classification FIRST (amendment M3): a committed ceremony answers
        // idempotently by payload digest without any re-verification or write. ----
        if (row.status === 'COMMITTED') {
          return row.payload_digest === input.payloadDigest
            ? { outcome: 'IDEMPOTENT_ACCEPTED' }
            : { outcome: 'DIGEST_CONFLICT' };
        }

        // ---- 3. State gates: approval must be durable, unexpired, by a still-eligible owner ----
        if (row.status !== 'APPROVED') return { outcome: 'NOT_APPROVED' };
        if (toDate(row.expires_at).getTime() <= input.now.getTime()) return { outcome: 'EXPIRED' };
        if (row.approved_by_account_id === null) return { outcome: 'NOT_ELIGIBLE' };
        if (!(await this.isOwnerEligibleOn(conn, row.family_id, row.approved_by_account_id))) {
          return { outcome: 'NOT_ELIGIBLE' };
        }

        // Non-locking device re-check (amendment H2): PAIRING_PENDING -> PAIRED owner-side pairing
        // may land while the ceremony is open; REVOKED / ACTIVE device states fail closed. No lock
        // is taken here, so the ceremony->floors lock order above is the only order the store uses.
        const [deviceRows] = await conn.execute<DeviceRow[]>(
          'SELECT family_id, status FROM devices WHERE device_id = ?',
          [row.device_id],
        );
        const device = deviceRows[0];
        if (!device || device.family_id !== row.family_id || !CERTIFICATE_STATES.has(device.status)) {
          return { outcome: 'DEVICE_NOT_ELIGIBLE' };
        }

        // ---- 4. Shared per-family serialization latch (same as every epoch append) ----
        await ensureAndLockFamilyFloors(conn, row.family_id, input.now);

        // ---- 5. Exactly one root per family: anchored durable absence check ----
        const [anchorRows] = await conn.execute<AnchorRow[]>(
          'SELECT family_id FROM family_authority_genesis_anchors WHERE family_id = ?',
          [row.family_id],
        );
        if (anchorRows.length > 0) return { outcome: 'ALREADY_BOOTSTRAPPED' };

        // ---- 6. Anchor insert: public material + dual-signature statement (A) ----
        await conn.execute(
          `INSERT INTO family_authority_genesis_anchors
             (family_id, genesis_device_id, genesis_dsk_key_id, genesis_dsk_public_key,
              protocol_version, created_at, signature, signature_scheme)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            row.family_id,
            input.anchor.deviceId,
            input.anchor.dskKeyId,
            input.anchor.dskPublicKey,
            TRUST_ROOT_PROTOCOL_VERSION,
            input.anchor.createdAt,
            input.anchor.signature,
            ANCHOR_SIGNATURE_SCHEME_FIRST_DEVICE,
          ],
        );

        const hook = this.commitHooks?.afterAnchorInsert;
        if (hook) await hook(conn);

        // ---- 7. Epoch-1 append through the certified Wave-5B path (same connection) ----
        const appendResult = await this.epochStore.appendAcceptedEpochOnConnection(conn, input.epochRecord, input.now);
        if (appendResult.outcome !== 'APPENDED') throw new EpochAppendRefusedError(appendResult.outcome);

        // ---- 8. Consume the challenge: committed result + durable payload digest ----
        const [update] = await conn.execute<ResultSetHeader>(
          `UPDATE family_first_device_bootstrap_ceremonies
              SET status = 'COMMITTED', outcome = 'ACCEPTED', payload_digest = ?,
                  bootstrap_proof_sha256 = ?, attestation_evidence_sha256 = ?,
                  consumed_at = ?, updated_at = ?
            WHERE ceremony_id = ? AND status = 'APPROVED'`,
          [input.payloadDigest, input.bootstrapProofSha256, input.attestationEvidenceSha256, input.now, input.now, input.ceremonyId],
        );
        if (update.affectedRows !== 1) {
          // Unreachable while the row lock is held; throw so nothing commits.
          throw new Error('first-device bootstrap ceremony commit lost its row lock');
        }

        return { outcome: 'ACCEPTED' };
      });
    } catch (error) {
      // A refused epoch append rolled the ENTIRE commit transaction back: no anchor, no epoch,
      // no consumed challenge -- the request may be retried while the ceremony is valid.
      if (error instanceof EpochAppendRefusedError) return { outcome: 'EPOCH_REJECTED' };
      // PK(family_id) on the anchor table is the invariant of record: losing the race to a
      // concurrent ceremony surfaces as a duplicate entry, mapped to ALREADY_BOOTSTRAPPED (H3).
      if (isDuplicateEntry(error)) return { outcome: 'ALREADY_BOOTSTRAPPED' };
      throw error;
    }
  }

  /**
   * Owner-eligibility predicate (§2, fail closed on every ambiguity):
   * the unique provisioned owner of an unsuspended family, holding an ACTIVE
   * ADMINISTRATOR membership in that family's service-account scope, with a
   * VERIFIED, enabled parent account. A NULL provisioned owner never matches.
   */
  private async isOwnerEligibleOn(conn: PoolConnection, familyId: string, accountId: string): Promise<boolean> {
    const [familyRows] = await conn.execute<FamilyRow[]>(
      'SELECT provisioned_for_account_id, status FROM families WHERE family_id = ?',
      [familyId],
    );
    const family = familyRows[0];
    if (!family) return false;
    if (family.provisioned_for_account_id === null || family.provisioned_for_account_id !== accountId) return false;
    if (family.status !== 'ACTIVE') return false;

    const [accountRows] = await conn.execute<AccountRow[]>(
      'SELECT status, disabled_at, service_account_id FROM parent_accounts WHERE account_id = ?',
      [accountId],
    );
    const account = accountRows[0];
    if (!account || account.status !== 'VERIFIED' || account.disabled_at !== null) return false;

    const [membershipRows] = await conn.execute<MembershipRow[]>(
      `SELECT role, service_account_id FROM family_parent_memberships
        WHERE family_id = ? AND account_id = ? AND status = 'ACTIVE' LIMIT 1`,
      [familyId, accountId],
    );
    const membership = membershipRows[0];
    if (!membership || membership.role !== 'ADMINISTRATOR') return false;
    if (String(membership.service_account_id) !== String(account.service_account_id)) return false;
    return true;
  }
}
