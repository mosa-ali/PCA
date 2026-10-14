import { isPlausibleEnvelopeCiphertext, isPlausibleOpaqueId } from './policy.js';
import type { DeleteEnvelopeResult, RecoveryRepository, StoreEnvelopeResult } from './RecoveryRepository.js';
import type { OpaqueFamilyId, RecoveryEnvelopeRecord } from './types.js';
import { FamilyAuditService, InMemoryFamilyAuditRepository } from '../familyrbac/FamilyAuditStore.js';

export type RecoveryErrorCode = 'INVALID_INPUT' | 'VERSION_MISMATCH' | 'NOT_FOUND';

/** Fixed, generic messages per code -- never interpolates ciphertext or the family id. */
export class RecoveryError extends Error {
  readonly code: RecoveryErrorCode;
  readonly currentVersion?: number | null;
  constructor(code: RecoveryErrorCode, currentVersion?: number | null) {
    super(RECOVERY_ERROR_MESSAGES[code]);
    this.name = 'RecoveryError';
    this.code = code;
    this.currentVersion = currentVersion;
  }
}

const RECOVERY_ERROR_MESSAGES: Record<RecoveryErrorCode, string> = {
  INVALID_INPUT: 'Recovery envelope input is malformed.',
  VERSION_MISMATCH: 'Recovery envelope was changed by another writer; re-read before retrying.',
  NOT_FOUND: 'Recovery envelope was not found.',
};

const MAX_RECOVERY_VERSION = 0xffff_ffff;
const MIN_MYSQL_DATETIME_MS = Date.UTC(1000, 0, 1);
const MAX_MYSQL_DATETIME_MS = Date.UTC(10000, 0, 1) - 1;

function isValidMySqlDateTime(value: unknown): value is Date {
  if (!(value instanceof Date)) return false;
  const timestamp = value.getTime();
  return Number.isFinite(timestamp) && timestamp >= MIN_MYSQL_DATETIME_MS && timestamp <= MAX_MYSQL_DATETIME_MS;
}

function isValidEnvelopeRecord(record: RecoveryEnvelopeRecord, familyId: OpaqueFamilyId): boolean {
  return record !== null && typeof record === 'object' &&
    record.familyId === familyId &&
    isPlausibleEnvelopeCiphertext(record.ciphertext) &&
    Number.isInteger(record.version) && record.version > 0 && record.version <= MAX_RECOVERY_VERSION &&
    isValidMySqlDateTime(record.createdAt) && isValidMySqlDateTime(record.updatedAt);
}

export class RecoveryService {
  private readonly repository: RecoveryRepository;
  private readonly now: () => Date;
  private readonly auditService: FamilyAuditService;

  constructor(
    repository: RecoveryRepository,
    now: () => Date = () => new Date(),
    auditService: FamilyAuditService = new FamilyAuditService(new InMemoryFamilyAuditRepository()),
  ) {
    this.repository = repository;
    this.now = now;
    this.auditService = auditService;
  }

  async fetchEnvelope(familyId: OpaqueFamilyId): Promise<RecoveryEnvelopeRecord> {
    if (!isPlausibleOpaqueId(familyId)) throw new RecoveryError('INVALID_INPUT');
    const record = await this.repository.getEnvelope(familyId);
    if (!record || !isValidEnvelopeRecord(record, familyId)) {
      // Treat corrupt/out-of-contract repository rows like no readable
      // envelope: do not expose another family's record or unbounded bytes.
      throw new RecoveryError('NOT_FOUND');
    }
    return record;
  }

  /**
   * Never inspects `ciphertext` beyond its byte length -- it is stored and
   * returned intact, produced and consumable only client-side.
   * expectedVersion: 0 to create a brand-new envelope; otherwise the
   * version last read by the caller, to detect a lost-update race.
   */
  async storeEnvelope(
    familyId: OpaqueFamilyId,
    ciphertext: Buffer,
    expectedVersion: number,
  ): Promise<RecoveryEnvelopeRecord> {
    if (!isPlausibleOpaqueId(familyId)) throw new RecoveryError('INVALID_INPUT');
    if (!isPlausibleEnvelopeCiphertext(ciphertext)) throw new RecoveryError('INVALID_INPUT');
    // MySQL stores the version as INT UNSIGNED. The current version may reach
    // UINT32_MAX, but it cannot be used as an expectedVersion for replacement
    // because the atomic repository update increments it by one.
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0 || expectedVersion >= MAX_RECOVERY_VERSION) {
      throw new RecoveryError('INVALID_INPUT');
    }

    // Take ownership before the repository's first asynchronous boundary.
    // Callers can reuse or mutate their Buffer while persistence is pending;
    // the exact bounded bytes validated here must be the bytes stored.
    const ciphertextSnapshot = Buffer.from(ciphertext);
    const clockValue: unknown = this.now();
    if (!isValidMySqlDateTime(clockValue)) throw new RecoveryError('INVALID_INPUT');
    const writeTime = new Date(clockValue.getTime());
    const result: StoreEnvelopeResult = await this.repository.storeEnvelope(
      familyId,
      ciphertextSnapshot,
      expectedVersion,
      writeTime,
    );
    if (result.outcome === 'VERSION_MISMATCH') throw new RecoveryError('VERSION_MISMATCH', result.currentVersion);
    await this.auditService.record({
      familyId,
      actionType: 'RECOVERY_EVENT',
      actorDeviceId: 'RECOVERY_ENVELOPE_WRITER',
      actorMemberId: null,
      targetScope: { kind: 'FAMILY', id: familyId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: result.record.version,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: 'RECOVERY',
      correlationId: null,
      actionId: null,
      freeTextNote: 'RECOVERY_ENVELOPE_STORED',
    });
    return result.record;
  }

  async deleteEnvelope(familyId: OpaqueFamilyId): Promise<void> {
    if (!isPlausibleOpaqueId(familyId)) throw new RecoveryError('INVALID_INPUT');
    const result: DeleteEnvelopeResult = await this.repository.deleteEnvelope(familyId);
    if (result.outcome === 'NOT_FOUND') throw new RecoveryError('NOT_FOUND');
    await this.auditService.record({
      familyId,
      actionType: 'RECOVERY_EVENT',
      actorDeviceId: 'RECOVERY_ENVELOPE_WRITER',
      actorMemberId: null,
      targetScope: { kind: 'FAMILY', id: familyId },
      authorizationRole: null,
      trustSetEpoch: 0,
      policyRevision: null,
      clientMonotonicSequence: null,
      resultStatus: 'SUCCESS',
      targetAcknowledgementCount: 0,
      reasonCategory: 'RECOVERY',
      correlationId: null,
      actionId: null,
      freeTextNote: 'RECOVERY_ENVELOPE_DELETED',
    });
  }
}
