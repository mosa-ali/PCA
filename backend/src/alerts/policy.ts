import type { ProtectionAlertTrigger } from './types.js';

export const MAX_ALERT_ID_LENGTH = 128;
export const MAX_ENCRYPTED_PAYLOAD_BYTES = 16 * 1024;
export const MAX_NONCE_BYTES = 64;

/** Every addendum trigger is represented explicitly; adding a trigger without
 * a policy row is a compile-time error. */
export const PROTECTION_ALERT_POLICY: Record<ProtectionAlertTrigger, { readonly requiresDeviceId: boolean }> = {
  DISABLE_OR_REMOVAL_REQUESTED: { requiresDeviceId: true },
  REPEATED_INVALID_PIN: { requiresDeviceId: true },
  AUTHORITY_CHANGE: { requiresDeviceId: true },
  CRITICAL_PERMISSION_OR_VPN_LOST: { requiresDeviceId: true },
  UNEXPECTED_OFFLINE: { requiresDeviceId: true },
  TIME_TAMPERING: { requiresDeviceId: true },
  PROTECTION_DEGRADED: { requiresDeviceId: true },
  REINSTALLATION: { requiresDeviceId: true },
  INVITATION_REDEEMED: { requiresDeviceId: false },
  UNENROLLMENT: { requiresDeviceId: true },
};

export function isPlausibleOpaqueId(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= MAX_ALERT_ID_LENGTH;
}

function decodeCanonicalBase64(candidate: unknown, maxBytes: number): boolean {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(candidate)) return false;
  const decoded = Buffer.from(candidate, 'base64');
  return decoded.length > 0 && decoded.length <= maxBytes && decoded.toString('base64') === candidate;
}

export function isPlausibleEncryptedPayload(candidate: unknown): candidate is string {
  return decodeCanonicalBase64(candidate, MAX_ENCRYPTED_PAYLOAD_BYTES);
}

export function isPlausibleNonce(candidate: unknown): candidate is string {
  return decodeCanonicalBase64(candidate, MAX_NONCE_BYTES);
}
