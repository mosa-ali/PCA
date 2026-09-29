import { execute, runInTransaction } from '../db/pool.js';
import { isPlausibleOpaqueId, isPlausibleSignature, MIN_TRUST_SET_EPOCH } from './policy.js';
import {
  TrustSetEpochStoreError,
  type AppendTrustSetEpochOutcome,
  type TrustSetEpochRecord,
  type TrustSetEpochStore,
} from './TrustSetEpochStore.js';
import type { OpaqueFamilyId } from './types.js';

/** 256 KiB upper bound for the opaque signed-epoch blob, mirroring the opaque-content ceilings used elsewhere in this schema. */
const MAX_SIGNED_EPOCH_BYTES = 262_144;
/** Bounded signer identity fields (key id / device id), narrower than MAX_OPAQUE_ID_LENGTH on purpose. */
const MAX_SIGNER_ID_LENGTH = 64;

interface EpochRow {
  family_id: string;
  trust_set_epoch: number;
  key_epoch: number;
  supersedes_epoch: number | null;
  signed_epoch_bytes: Buffer;
  signature: string;
  signer_key_id: string;
  signer_device_id: string;
  issued_at: Date | string;
  received_at: Date | string;
}

interface FloorRow {
  minimum_accepted_trust_set_epoch: number;
  minimum_accepted_key_epoch: number;
}

const EPOCH_COLUMNS = `family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at`;

function invalidInput(message: string): TrustSetEpochStoreError {
  return new TrustSetEpochStoreError(`Invalid accepted-epoch input: ${message}`);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function isBoundedNonEmptyString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

/**
 * Structural validation, run BEFORE any SQL/transaction work so a
 * malformed submission can never create a floors row, an epoch row, or any
 * other side effect. Semantic acceptance (signature verification, exactly
 * one ACTIVE OWNER, monotonic rules pre-checked by the caller) is NOT this
 * layer's concern -- it only bounds the shape of the durable record.
 */
function assertValidAppendRecord(record: TrustSetEpochRecord): void {
  if (!isPlausibleOpaqueId(record.familyId)) {
    throw invalidInput('familyId must be a non-empty string of at most 128 characters.');
  }
  if (typeof record.trustSetEpoch !== 'number' || !Number.isInteger(record.trustSetEpoch) || record.trustSetEpoch < MIN_TRUST_SET_EPOCH) {
    throw invalidInput('trustSetEpoch must be an integer >= 1.');
  }
  if (typeof record.keyEpoch !== 'number' || !Number.isInteger(record.keyEpoch) || record.keyEpoch < 1) {
    throw invalidInput('keyEpoch must be an integer >= 1.');
  }
  const supersedes = record.supersedesEpoch;
  if (
    supersedes !== null &&
    (typeof supersedes !== 'number' || !Number.isInteger(supersedes) || supersedes < 1 || supersedes > record.trustSetEpoch - 1)
  ) {
    throw invalidInput('supersedesEpoch must be null or an integer in 1..trustSetEpoch-1.');
  }
  if (!Buffer.isBuffer(record.signedEpochBytes) || record.signedEpochBytes.length < 1 || record.signedEpochBytes.length > MAX_SIGNED_EPOCH_BYTES) {
    throw invalidInput(`signedEpochBytes must be a Buffer of 1..${MAX_SIGNED_EPOCH_BYTES} bytes.`);
  }
  if (!isPlausibleSignature(record.signature)) {
    throw invalidInput('signature must be a non-empty string of at most 512 characters.');
  }
  if (!isBoundedNonEmptyString(record.signerKeyId, MAX_SIGNER_ID_LENGTH)) {
    throw invalidInput(`signerKeyId must be a non-empty string of at most ${MAX_SIGNER_ID_LENGTH} characters.`);
  }
  if (!isBoundedNonEmptyString(record.signerDeviceId, MAX_SIGNER_ID_LENGTH)) {
    throw invalidInput(`signerDeviceId must be a non-empty string of at most ${MAX_SIGNER_ID_LENGTH} characters.`);
  }
  if (!isValidDate(record.issuedAt)) {
    throw invalidInput('issuedAt must be a valid Date.');
  }
  if (!isValidDate(record.receivedAt)) {
    throw invalidInput('receivedAt must be a valid Date.');
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? new Date(value) : new Date(value);
}

function toRecord(row: EpochRow): TrustSetEpochRecord {
  return {
    familyId: row.family_id,
    trustSetEpoch: Number(row.trust_set_epoch),
    keyEpoch: Number(row.key_epoch),
    supersedesEpoch: row.supersedes_epoch === null ? null : Number(row.supersedes_epoch),
    // Copy the driver-returned buffer so no caller ever aliases (or mutates)
    // driver-internal state.
    signedEpochBytes: Buffer.from(row.signed_epoch_bytes),
    signature: row.signature,
    signerKeyId: row.signer_key_id,
    signerDeviceId: row.signer_device_id,
    issuedAt: toDate(row.issued_at),
    receivedAt: toDate(row.received_at),
  };
}

/**
 * Durable, MySQL-backed TrustSetEpochStore over the migration-0060 tables
 * `family_trust_set_epochs` (accepted signed epochs) and
 * `family_epoch_floors` (per-family monotonic acceptance floors).
 *
 * This class is the ONLY writer of either table. `appendAcceptedEpoch` runs
 * as a single READ COMMITTED transaction (`runInTransaction`) so an epoch
 * row and the floors it advances are committed together or not at all:
 *
 *   a. Structural validation (above) -- before any SQL.
 *   b. Ensure the family's floors row exists (`INSERT ... ON DUPLICATE KEY
 *      UPDATE family_id = family_id`; a no-op that still takes the row
 *      lock on the normal path).
 *   c. `SELECT ... FOR UPDATE` the floors row: this single row is the
 *      per-family serialization point for every append, so two concurrent
 *      accepted epochs for one family are ordered by the database itself,
 *      not by any in-process state.
 *   d. Duplicate check FIRST: if (familyId, trustSetEpoch) already exists,
 *      the submission resolves as IDEMPOTENT_MATCH (byte-identical signed
 *      bytes, identical signature AND equal keyEpoch) or CONFLICT
 *      (anything else) -- a conflicting re-use of an already-accepted
 *      trust-set epoch number can never overwrite or extend the recorded
 *      row, and is surfaced, never absorbed.
 *   e. Anti-rollback floors: trustSetEpoch < floor -> REJECTED_STALE /
 *      STALE_TRUST_SET_EPOCH; keyEpoch < key floor -> REJECTED_STALE /
 *      STALE_KEY_EPOCH. A lower-numbered epoch can never be appended even
 *      when it carries a HIGHER key epoch, and an already-rotated-past key
 *      epoch can never be re-admitted under a newer trust-set number.
 *      The trust-set comparison is strictly-less-than because the floor is
 *      the MINIMUM accepted epoch: equality is already owned by the
 *      duplicate check in (d) for every row-backed floor (the floor value
 *      always equals an existing row's trustSetEpoch, since row and floor
 *      are written in one transaction), and the only reachable equality
 *      WITHOUT a backing row is the virgin floor seeded at 1 -- where a
 *      genesis epoch (trustSetEpoch = 1) is exactly the legitimate first
 *      append this store exists to persist.
 *   f. INSERT the epoch row (all ten columns, bytes verbatim).
 *   g. Advance the floors: trust-set floor := the just-accepted
 *      trustSetEpoch (never below the old floor -- see (e)); key floor :=
 *      GREATEST(old key floor, accepted keyEpoch) (equal keyEpoch is
 *      legitimate -- a trust-set-metadata-only epoch need not rotate FDEK
 *      material -- but the floor can never fall).
 *
 * The duplicate check intentionally runs BEFORE the staleness check, so a
 * retry of the CURRENT latest epoch resolves as IDEMPOTENT_MATCH (or
 * CONFLICT) rather than degrading into a vague stale rejection.
 *
 * Persistence here still grants NO authority: this class never verifies
 * signatures and never decides acceptance; callers may only invoke
 * `appendAcceptedEpoch` strictly after a full acceptance decision.
 */
export class MySqlTrustSetEpochStore implements TrustSetEpochStore {
  async appendAcceptedEpoch(record: TrustSetEpochRecord): Promise<AppendTrustSetEpochOutcome> {
    assertValidAppendRecord(record);
    const now = new Date();
    return runInTransaction<AppendTrustSetEpochOutcome>(async (conn) => {
      await execute(
        conn,
        `INSERT INTO family_epoch_floors (family_id, minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch, updated_at)
         VALUES (?, 1, 1, ?)
         ON DUPLICATE KEY UPDATE family_id = family_id`,
        [record.familyId, now],
      );

      const { rows: floorRows } = await execute<FloorRow>(
        conn,
        `SELECT minimum_accepted_trust_set_epoch, minimum_accepted_key_epoch
         FROM family_epoch_floors
         WHERE family_id = ?
         FOR UPDATE`,
        [record.familyId],
      );
      const floor = floorRows[0];
      if (!floor) {
        // Unreachable on a healthy schema: the ensure-insert above runs in
        // this same transaction. Fail closed rather than proceed with no
        // recorded floors behind the append.
        throw new Error('family_epoch_floors row missing after ensure-insert; refusing to append without floors.');
      }
      const floorTrustSetEpoch = Number(floor.minimum_accepted_trust_set_epoch);
      const floorKeyEpoch = Number(floor.minimum_accepted_key_epoch);

      const { rows: existingRows } = await execute<EpochRow>(
        conn,
        `SELECT ${EPOCH_COLUMNS} FROM family_trust_set_epochs WHERE family_id = ? AND trust_set_epoch = ?`,
        [record.familyId, record.trustSetEpoch],
      );
      const existing = existingRows[0];
      if (existing) {
        const storedBytes = Buffer.isBuffer(existing.signed_epoch_bytes)
          ? existing.signed_epoch_bytes
          : Buffer.from(existing.signed_epoch_bytes);
        if (
          storedBytes.equals(record.signedEpochBytes) &&
          existing.signature === record.signature &&
          Number(existing.key_epoch) === record.keyEpoch
        ) {
          return { outcome: 'IDEMPOTENT_MATCH' };
        }
        return { outcome: 'CONFLICT' };
      }

      // Strictly-less-than: the floor is the MINIMUM accepted trust-set
      // epoch. Equality here is unreachable for a row-backed floor (the
      // duplicate check above already resolved it as IDEMPOTENT_MATCH or
      // CONFLICT); the only equality without a backing row is the virgin
      // floor of 1, where a genesis epoch (trustSetEpoch = 1) must be
      // appendable.
      if (record.trustSetEpoch < floorTrustSetEpoch) {
        return { outcome: 'REJECTED_STALE', reason: 'STALE_TRUST_SET_EPOCH' };
      }
      if (record.keyEpoch < floorKeyEpoch) {
        return { outcome: 'REJECTED_STALE', reason: 'STALE_KEY_EPOCH' };
      }

      await execute(
        conn,
        `INSERT INTO family_trust_set_epochs
           (family_id, trust_set_epoch, key_epoch, supersedes_epoch, signed_epoch_bytes, signature, signer_key_id, signer_device_id, issued_at, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.familyId,
          record.trustSetEpoch,
          record.keyEpoch,
          record.supersedesEpoch,
          record.signedEpochBytes,
          record.signature,
          record.signerKeyId,
          record.signerDeviceId,
          record.issuedAt,
          record.receivedAt,
        ],
      );

      await execute(
        conn,
        `UPDATE family_epoch_floors
         SET minimum_accepted_trust_set_epoch = ?,
             minimum_accepted_key_epoch = GREATEST(minimum_accepted_key_epoch, ?),
             updated_at = ?
         WHERE family_id = ?`,
        [record.trustSetEpoch, record.keyEpoch, now, record.familyId],
      );

      return { outcome: 'APPENDED' };
    });
  }

  async readLatestEpoch(familyId: OpaqueFamilyId): Promise<TrustSetEpochRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<EpochRow>(
        conn,
        `SELECT ${EPOCH_COLUMNS} FROM family_trust_set_epochs WHERE family_id = ? ORDER BY trust_set_epoch DESC LIMIT 1`,
        [familyId],
      ),
    );
    return rows[0] ? toRecord(rows[0]) : null;
  }

  async listEpochs(familyId: OpaqueFamilyId): Promise<TrustSetEpochRecord[]> {
    const { rows } = await runInTransaction((conn) =>
      execute<EpochRow>(
        conn,
        `SELECT ${EPOCH_COLUMNS} FROM family_trust_set_epochs WHERE family_id = ? ORDER BY trust_set_epoch ASC`,
        [familyId],
      ),
    );
    return rows.map(toRecord);
  }
}
