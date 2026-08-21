import type { DeviceProtectionStatusRepository } from '../device/DeviceProtectionStatusRepository.js';

/**
 * PCA-ADD-ENR-016/PCA-FR-145 (doc 08 Section 8): the real, source-complete
 * replacement for UnavailableProtectiveAuthorityResolver, reading the
 * durable status device_protection_status records (migration 0024) --
 * never request.protectionLevel, never a Parent Web-supplied value, never
 * a caller-supplied role.
 *
 * That status can only ever be written through
 * POST /v1/runtime-sync/protection-status, which requires a verified
 * device-session bearer token (requireDeviceSession, the same real
 * channel every other device-identity-bound runtime-sync route uses) --
 * see runtimeSyncRoutes.ts's own registration for that route. Device
 * session issuance itself requires a real signed challenge-response
 * (DeviceAuthService/DeviceSessionService), verified through
 * DeviceSignatureVerifier -- production wires RejectingDeviceSignatureVerifier
 * there (PCA-DEC-020, CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW),
 * identical to every other signed-device-data path in this codebase
 * (envelope acceptance, signed remote-parent removal decisions, Safe
 * Zone). This resolver's own logic is genuinely complete and correct
 * today; it fails closed in production only because no device can
 * currently complete the shared session-authentication step that would
 * ever populate a row for it to read -- the SAME external gate as
 * everything else signed-device-identity-related, not a second,
 * independent one. The moment that gate lifts, this resolver starts
 * working with zero further code changes.
 *
 * Fail-closed by construction, not merely by accident of missing data:
 * - no row for this exact (familyId, deviceId) pair -> false (never assume PROTECTED)
 * - row belongs to a different family (should be structurally impossible
 *   given findForDevice's own WHERE clause, but checked explicitly anyway
 *   as defense in depth) -> false
 * - row exists but is older than maxStalenessMs -> false (a device that
 *   stopped reporting must not be trusted to still be under management
 *   authority indefinitely)
 * - row exists, fresh, and protectionLevel is PROTECTED or DEGRADED (still
 *   under some management authority, just impaired) -> true
 * - STANDARD/AUTHORIZATION_REQUIRED/NOT_SUPPORTED -> false (no protective
 *   authority to gate a removal decision behind)
 */
export class RealProtectiveAuthorityResolver {
  private readonly repository: DeviceProtectionStatusRepository;
  private readonly maxStalenessMs: number;
  private readonly now: () => Date;

  constructor(repository: DeviceProtectionStatusRepository, options: { maxStalenessMs?: number; now?: () => Date } = {}) {
    this.repository = repository;
    // 24 hours: long enough that an ordinary sync-interval gap or brief
    // offline period never falsely drops protective authority, short
    // enough that a device that has genuinely stopped reporting (lost,
    // factory-reset without a clean removal, compromised) is not trusted
    // to still be under management authority indefinitely.
    this.maxStalenessMs = options.maxStalenessMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  async resolve(familyId: string, deviceId: string): Promise<boolean> {
    const record = await this.repository.findForDevice(familyId, deviceId);
    if (record === null) return false;
    if (record.familyId !== familyId || record.deviceId !== deviceId) return false;
    if (this.now().getTime() - record.updatedAt.getTime() > this.maxStalenessMs) return false;
    return record.protectionLevel === 'PROTECTED' || record.protectionLevel === 'DEGRADED';
  }
}
