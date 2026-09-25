import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  PARENT_COMMERCIAL_STEP_UP_TTL_MS,
  PARENT_MFA_ENROLLMENT_TICKET_TTL_MS,
  PARENT_MFA_FAILURE_POLICY,
  PARENT_MFA_GRACE_MS,
} from '../policy.js';
import type { ParentAccountId } from '../types.js';
import { buildParentOtpauthUri, generateSealedParentTotpSecret, verifySealedParentTotp, type ParentMfaKeyring } from './parentTotp.js';
import type {
  CommercialStepUpOperation,
  ParentMfaRecoveryCode,
  ParentMfaRepository,
  ParentMfaStateRecord,
  ParentMfaTicketPurpose,
  ParentSecurityEventType,
} from './ParentMfaRepository.js';

export type ParentMfaErrorCode = 'INVALID_CODE' | 'LOCKED' | 'NOT_ENROLLED' | 'ALREADY_ENROLLED' | 'NO_PENDING_ENROLLMENT';

/** Never carries a secret, a code, or which of several internal checks failed beyond this coarse code. */
export class ParentMfaError extends Error {
  readonly code: ParentMfaErrorCode;
  constructor(code: ParentMfaErrorCode) {
    super(code);
    this.name = 'ParentMfaError';
    this.code = code;
  }
}

/**
 * Server-derived MFA posture. NOT_STARTED: the account has never completed a
 * login (no grace row). GRACE: not enrolled, grace still running.
 * SETUP_REQUIRED: not enrolled and grace over -- no session may be issued.
 */
export type ParentMfaPosture =
  | { status: 'NOT_STARTED' }
  | { status: 'RECOVERY_PENDING'; recoveryAvailableAt: Date }
  | { status: 'GRACE'; graceExpiresAt: Date }
  | { status: 'SETUP_REQUIRED'; graceExpiresAt: Date }
  | { status: 'ACTIVE'; enrolledAt: Date };

export interface ParentMfaServiceDeps {
  repository: ParentMfaRepository;
  /** Resolved lazily so a deployment without the key fails closed per operation rather than at import. main.ts additionally refuses to boot a production runtime without it. */
  keyring: () => ParentMfaKeyring;
  now?: () => Date;
}

const TICKET_DOMAIN = 'PCA_PARENT_MFA_ENROLLMENT_TICKET_V1\0';
const STEP_UP_DOMAIN = 'PCA_PARENT_COMMERCIAL_STEP_UP_V1\0';
const OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function hashOpaque(domain: string, raw: string): string {
  return createHash('sha256').update(domain + raw, 'utf8').digest('hex');
}

export function isPlausibleOpaqueToken(value: unknown): value is string {
  return typeof value === 'string' && OPAQUE_TOKEN_PATTERN.test(value);
}

export class ParentMfaService {
  private readonly repository: ParentMfaRepository;
  private readonly keyring: () => ParentMfaKeyring;
  private readonly now: () => Date;

  constructor(deps: ParentMfaServiceDeps) {
    this.repository = deps.repository;
    this.keyring = deps.keyring;
    this.now = deps.now ?? (() => new Date());
  }

  static postureOf(state: ParentMfaStateRecord | null, now: Date): ParentMfaPosture {
    if (!state) return { status: 'NOT_STARTED' };
    if (state.recoveryHoldExpiresAt) return { status: 'RECOVERY_PENDING', recoveryAvailableAt: state.recoveryHoldExpiresAt };
    if (state.status === 'ACTIVE' && state.enrolledAt) return { status: 'ACTIVE', enrolledAt: state.enrolledAt };
    if (state.graceExpiresAt.getTime() > now.getTime()) return { status: 'GRACE', graceExpiresAt: state.graceExpiresAt };
    return { status: 'SETUP_REQUIRED', graceExpiresAt: state.graceExpiresAt };
  }

  async posture(accountId: ParentAccountId): Promise<ParentMfaPosture> {
    return ParentMfaService.postureOf(await this.repository.findState(accountId), this.now());
  }

  /** Starts the one and only grace window. Returns whether THIS call started it (i.e. this is the account's first login). */
  async startGraceIfAbsent(accountId: ParentAccountId): Promise<{ started: boolean; posture: ParentMfaPosture }> {
    const now = this.now();
    const started = await this.repository.startGraceIfAbsent(accountId, now, new Date(now.getTime() + PARENT_MFA_GRACE_MS));
    if (started) await this.event(accountId, 'MFA_GRACE_STARTED', null);
    return { started, posture: await this.posture(accountId) };
  }

  /** Verifies a code against the ACTIVE factor: lockout, timing-safe match, then a forward-only counter claim (replay). */
  async verifyActiveCode(accountId: ParentAccountId, code: string, failureEvent: 'MFA_LOGIN_FAILED' | 'STEP_UP_FAILED'): Promise<void> {
    const state = await this.repository.findState(accountId);
    if (!state || state.status !== 'ACTIVE' || !state.totpSecretCiphertext || !state.totpSecretNonce) throw new ParentMfaError('NOT_ENROLLED');
    const now = this.now();
    if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) throw new ParentMfaError('LOCKED');
    const counter = verifySealedParentTotp(state.totpSecretCiphertext, state.totpSecretNonce, this.keyring(), code, now.getTime());
    if (counter === null || !(await this.repository.claimTotpCounter(accountId, counter, now))) {
      await this.fail(accountId, failureEvent);
    }
    await this.repository.clearFailures(accountId, now);
  }

  /**
   * Seals a fresh secret as PENDING (never touching an ACTIVE factor) and
   * returns the otpauth URI and base32 secret for this one response only.
   */
  async beginEnrollment(accountId: ParentAccountId, accountLabel: string): Promise<{ otpauthUri: string; secretBase32: string }> {
    const state = await this.repository.findState(accountId);
    if (!state) throw new ParentMfaError('NO_PENDING_ENROLLMENT');
    if (state.status === 'ACTIVE') throw new ParentMfaError('ALREADY_ENROLLED');
    const { sealed, secretBase32 } = generateSealedParentTotpSecret(this.keyring());
    await this.repository.savePendingSecret(accountId, sealed.ciphertext, sealed.nonce, this.now());
    return { otpauthUri: buildParentOtpauthUri(accountLabel, secretBase32), secretBase32 };
  }

  /** Activates the pending secret only after one valid 6-digit code, claiming that code's counter in the same CAS. */
  async confirmEnrollment(accountId: ParentAccountId, code: string): Promise<void> {
    const state = await this.repository.findState(accountId);
    if (!state) throw new ParentMfaError('NO_PENDING_ENROLLMENT');
    if (state.status === 'ACTIVE') throw new ParentMfaError('ALREADY_ENROLLED');
    if (!state.pendingSecretCiphertext || !state.pendingSecretNonce) throw new ParentMfaError('NO_PENDING_ENROLLMENT');
    const now = this.now();
    if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) throw new ParentMfaError('LOCKED');
    const counter = verifySealedParentTotp(state.pendingSecretCiphertext, state.pendingSecretNonce, this.keyring(), code, now.getTime());
    if (counter === null) await this.fail(accountId, 'MFA_LOGIN_FAILED');
    if (!(await this.repository.activatePendingSecret(accountId, state.pendingSecretCiphertext, counter as number, now))) {
      // A concurrent confirmation or a newer pending secret won; this code no longer authorizes anything.
      throw new ParentMfaError('INVALID_CODE');
    }
    await this.event(accountId, 'MFA_ENROLLED', null);
  }

  /** Lost-authenticator recovery: the ACTIVE factor is destroyed; grace can only shrink, never restart. */
  async reset(accountId: ParentAccountId): Promise<boolean> {
    const reset = await this.repository.resetEnrollment(accountId, this.now());
    if (reset) await this.event(accountId, 'MFA_RESET', null);
    return reset;
  }

  recordRecoveryCode(accountId: ParentAccountId, codeHash: string, createdAt: Date, expiresAt: Date): Promise<void> {
    return this.repository.insertRecoveryCode({ codeId: randomUUID(), accountId, codeHash, createdAt, expiresAt });
  }

  latestRecoveryCode(accountId: ParentAccountId): Promise<ParentMfaRecoveryCode | null> {
    return this.repository.findLatestRecoveryCode(accountId);
  }

  incrementRecoveryAttempt(codeId: string): Promise<void> {
    return this.repository.incrementRecoveryAttempt(codeId);
  }

  consumeRecoveryCode(codeId: string): Promise<boolean> {
    return this.repository.consumeRecoveryCode(codeId, this.now());
  }

  applyRecoveryCode(input: { codeId: string; accountId: ParentAccountId; serviceAccountId: string | null; now: Date; holdExpiresAt: Date }) {
    return this.repository.applyRecoveryCode(input);
  }

  async issueTicket(accountId: ParentAccountId, purpose: ParentMfaTicketPurpose): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const now = this.now();
    await this.repository.insertTicket({
      ticketId: randomUUID(),
      accountId,
      tokenHash: hashOpaque(TICKET_DOMAIN, raw),
      purpose,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PARENT_MFA_ENROLLMENT_TICKET_TTL_MS),
    });
    return raw;
  }

  async resolveTicket(raw: unknown): Promise<{ ticketId: string; accountId: ParentAccountId; purpose: ParentMfaTicketPurpose } | null> {
    if (!isPlausibleOpaqueToken(raw)) return null;
    return this.repository.findLiveTicket(hashOpaque(TICKET_DOMAIN, raw), this.now());
  }

  consumeTicket(ticketId: string): Promise<boolean> {
    return this.repository.consumeTicket(ticketId, this.now());
  }

  /** Fresh TOTP (a counter newer than any accepted before, including at login) buys one single-use grant for one operation in one family. */
  async issueCommercialStepUp(accountId: ParentAccountId, familyId: string, operation: CommercialStepUpOperation, code: string): Promise<{ stepUpToken: string; expiresAt: Date }> {
    await this.verifyActiveCode(accountId, code, 'STEP_UP_FAILED');
    const raw = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + PARENT_COMMERCIAL_STEP_UP_TTL_MS);
    await this.repository.insertStepUpGrant({ grantId: randomUUID(), accountId, familyId, operation, tokenHash: hashOpaque(STEP_UP_DOMAIN, raw), createdAt: now, expiresAt });
    await this.event(accountId, 'STEP_UP_GRANTED', operation);
    return { stepUpToken: raw, expiresAt };
  }

  async consumeCommercialStepUp(accountId: ParentAccountId, familyId: string, operation: CommercialStepUpOperation, raw: unknown): Promise<boolean> {
    if (!isPlausibleOpaqueToken(raw)) return false;
    const consumed = await this.repository.consumeStepUpGrant({ tokenHash: hashOpaque(STEP_UP_DOMAIN, raw), accountId, familyId, operation, now: this.now() });
    if (consumed) await this.event(accountId, 'STEP_UP_CONSUMED', operation);
    return consumed;
  }

  async event(accountId: ParentAccountId, type: ParentSecurityEventType, detail: string | null): Promise<void> {
    await this.repository.recordSecurityEvent(accountId, type, detail, this.now());
  }

  private async fail(accountId: ParentAccountId, failureEvent: 'MFA_LOGIN_FAILED' | 'STEP_UP_FAILED'): Promise<never> {
    const { locked } = await this.repository.recordFailure(accountId, this.now(), PARENT_MFA_FAILURE_POLICY);
    await this.event(accountId, failureEvent, null);
    if (locked) {
      await this.event(accountId, 'MFA_LOCKED', null);
      throw new ParentMfaError('LOCKED');
    }
    throw new ParentMfaError('INVALID_CODE');
  }
}
