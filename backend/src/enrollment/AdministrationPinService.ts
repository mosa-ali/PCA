import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

/** PCA-ADD-ENR-012: the offline fallback recommendation is six digits or stronger. */
export const ADMINISTRATION_PIN_MIN_LENGTH = 6;
export const ADMINISTRATION_PIN_MAX_LENGTH = 64;

const VERIFIER_BYTES = 32;
const FAILURE_LOCKOUT_THRESHOLD = 5;
const FAILURE_LOCKOUT_MS = 30_000;
const FAILURE_DELAY_BASE_MS = 250;
const FAILURE_DELAY_MAX_MS = 4_000;
const SCRYPT_OPTIONS = {
  N: 32_768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;

export type AdministrationPinVerification =
  | { ok: true }
  | { ok: false; code: 'NOT_CONFIGURED' | 'INVALID_PIN' | 'RATE_LIMITED'; retryAfterMs: number };

/**
 * This is deliberately a verifier record, never a credential DTO. A durable
 * implementation must persist only these fields (or an equivalent reviewed
 * representation), never the raw PIN.
 */
export interface AdministrationPinRecord {
  familyId: string;
  saltB64: string;
  verifierB64: string;
  failedAttempts: number;
  lockedUntilUtc: string | null;
  updatedAtUtc: string;
}

export interface AdministrationPinRepository {
  get(familyId: string): Promise<AdministrationPinRecord | null>;
  upsert(record: AdministrationPinRecord): Promise<void>;
  clearFailures(familyId: string): Promise<void>;
  recordFailure(
    familyId: string,
    now: Date,
    lockoutThreshold: number,
    lockoutMs: number,
  ): Promise<{ failedAttempts: number; lockedUntilUtc: string | null }>;
}

/** Reference repository for focused local tests; production composition supplies a durable atomic store. */
export class InMemoryAdministrationPinRepository implements AdministrationPinRepository {
  private readonly records = new Map<string, AdministrationPinRecord>();

  async get(familyId: string): Promise<AdministrationPinRecord | null> {
    const record = this.records.get(familyId);
    return record === undefined ? null : { ...record };
  }

  async upsert(record: AdministrationPinRecord): Promise<void> {
    this.records.set(record.familyId, { ...record });
  }

  async clearFailures(familyId: string): Promise<void> {
    const record = this.records.get(familyId);
    if (record === undefined) return;
    this.records.set(familyId, {
      ...record,
      failedAttempts: 0,
      lockedUntilUtc: null,
      updatedAtUtc: new Date().toISOString(),
    });
  }

  async recordFailure(
    familyId: string,
    now: Date,
    lockoutThreshold: number,
    lockoutMs: number,
  ): Promise<{ failedAttempts: number; lockedUntilUtc: string | null }> {
    const record = this.records.get(familyId);
    if (record === undefined) return { failedAttempts: 0, lockedUntilUtc: null };
    const failedAttempts = record.failedAttempts + 1;
    const lockedUntilUtc = failedAttempts >= lockoutThreshold
      ? new Date(now.getTime() + lockoutMs).toISOString()
      : null;
    this.records.set(familyId, {
      ...record,
      failedAttempts,
      lockedUntilUtc,
      updatedAtUtc: now.toISOString(),
    });
    return { failedAttempts, lockedUntilUtc };
  }
}

export interface AdministrationPinServiceOptions {
  repository: AdministrationPinRepository;
  now?: () => Date;
  /** Injected in tests so failure-delay behavior can be verified without waiting. */
  sleep?: (milliseconds: number) => Promise<void>;
}

export interface AdministrationPinStatus {
  configured: boolean;
  minimumRecommendedLength: number;
  offlineFallbackRole: 'LOCAL_ADMINISTRATION_AUTHORIZATION';
  lockedUntilUtc: string | null;
}

export class AdministrationPinError extends Error {
  readonly code: 'INVALID_FAMILY_ID' | 'INVALID_PIN' | 'PIN_NOT_CONFIGURED';

  constructor(code: 'INVALID_FAMILY_ID' | 'INVALID_PIN' | 'PIN_NOT_CONFIGURED') {
    super({
      INVALID_FAMILY_ID: 'Family identifier is malformed.',
      INVALID_PIN: 'Administration PIN does not meet the required format.',
      PIN_NOT_CONFIGURED: 'Administration PIN is not configured.',
    }[code]);
    this.name = 'AdministrationPinError';
    this.code = code;
  }
}

/**
 * Family-scoped Administration PIN verifier for the offline authorization
 * fallback. Family-RBAC/step-up authorization for changing this setting is a
 * coordinator binding; this class never trusts a caller-supplied role.
 */
export class AdministrationPinService {
  private readonly repository: AdministrationPinRepository;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(options: AdministrationPinServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async configurePin(familyId: string, pin: string): Promise<AdministrationPinStatus> {
    assertFamilyId(familyId);
    assertPin(pin);
    const salt = randomBytes(16);
    const verifier = await deriveVerifier(pin, salt);
    await this.repository.upsert({
      familyId,
      saltB64: salt.toString('base64url'),
      verifierB64: verifier.toString('base64url'),
      failedAttempts: 0,
      lockedUntilUtc: null,
      updatedAtUtc: this.now().toISOString(),
    });
    return {
      configured: true,
      minimumRecommendedLength: ADMINISTRATION_PIN_MIN_LENGTH,
      offlineFallbackRole: 'LOCAL_ADMINISTRATION_AUTHORIZATION',
      lockedUntilUtc: null,
    };
  }

  async getStatus(familyId: string): Promise<AdministrationPinStatus> {
    assertFamilyId(familyId);
    const record = await this.repository.get(familyId);
    return {
      configured: record !== null,
      minimumRecommendedLength: ADMINISTRATION_PIN_MIN_LENGTH,
      offlineFallbackRole: 'LOCAL_ADMINISTRATION_AUTHORIZATION',
      lockedUntilUtc: record?.lockedUntilUtc ?? null,
    };
  }

  async verifyPin(familyId: string, pin: string): Promise<AdministrationPinVerification> {
    assertFamilyId(familyId);
    const record = await this.repository.get(familyId);
    if (record === null) return { ok: false, code: 'NOT_CONFIGURED', retryAfterMs: 0 };

    const now = this.now();
    const lockedUntil = record.lockedUntilUtc === null ? null : Date.parse(record.lockedUntilUtc);
    if (lockedUntil !== null && Number.isFinite(lockedUntil) && now.getTime() < lockedUntil) {
      return { ok: false, code: 'RATE_LIMITED', retryAfterMs: lockedUntil - now.getTime() };
    }

    const validShape = isValidPin(pin);
    let matches = false;
    if (validShape) {
      const salt = Buffer.from(record.saltB64, 'base64url');
      const expected = Buffer.from(record.verifierB64, 'base64url');
      const candidate = await deriveVerifier(pin, salt);
      matches = candidate.length === expected.length && timingSafeEqual(candidate, expected);
    }

    if (matches) {
      await this.repository.clearFailures(familyId);
      return { ok: true };
    }

    const failure = await this.repository.recordFailure(
      familyId,
      now,
      FAILURE_LOCKOUT_THRESHOLD,
      FAILURE_LOCKOUT_MS,
    );
    const progressiveDelay = Math.min(
      FAILURE_DELAY_MAX_MS,
      FAILURE_DELAY_BASE_MS * 2 ** Math.max(0, Math.min(failure.failedAttempts - 1, 4)),
    );
    await this.sleep(progressiveDelay);
    if (failure.lockedUntilUtc !== null) {
      return {
        ok: false,
        code: 'RATE_LIMITED',
        retryAfterMs: Math.max(0, Date.parse(failure.lockedUntilUtc) - this.now().getTime()),
      };
    }
    return { ok: false, code: 'INVALID_PIN', retryAfterMs: progressiveDelay };
  }
}

function assertFamilyId(value: string): void {
  if (!isOpaqueId(value)) throw new AdministrationPinError('INVALID_FAMILY_ID');
}

function assertPin(value: string): void {
  if (!isValidPin(value)) throw new AdministrationPinError('INVALID_PIN');
}

function isValidPin(value: string): boolean {
  return typeof value === 'string' && /^\d+$/.test(value) && value.length >= ADMINISTRATION_PIN_MIN_LENGTH && value.length <= ADMINISTRATION_PIN_MAX_LENGTH;
}

function isOpaqueId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && /^[A-Za-z0-9._:-]+$/.test(value);
}

async function deriveVerifier(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(pin, salt, VERIFIER_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error !== null) {
        reject(error);
        return;
      }
      resolve(derivedKey);
    });
  });
}
