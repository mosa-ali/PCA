import type { InvitationRecord } from '../invitation/types.js';
import type { PairingRequestView } from '../pairing/types.js';

/**
 * Explicit, allowlisted HTTP response shapes. Every field is listed by
 * hand -- domain records are NEVER spread or serialized directly, so a
 * future field added to a domain type (e.g. tokenHash) cannot silently
 * leak over HTTP just because it exists on the record.
 */
export interface InvitationDto {
  invitationId: string;
  familyId: string;
  platform: string;
  requestedProtectionMode: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  redeemedAt: string | null;
  revokedAt: string | null;
}

export function toInvitationDto(record: InvitationRecord): InvitationDto {
  return {
    invitationId: record.invitationId,
    familyId: record.familyId,
    platform: record.platform,
    requestedProtectionMode: record.requestedProtectionMode,
    status: record.status,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
    openedAt: record.openedAt ? record.openedAt.toISOString() : null,
    redeemedAt: record.redeemedAt ? record.redeemedAt.toISOString() : null,
    revokedAt: record.revokedAt ? record.revokedAt.toISOString() : null,
  };
}

/** rawInvitationToken is present ONLY on the creation response -- it is never returned by status/list, and is never persisted. */
export interface InvitationCreatedDto extends InvitationDto {
  rawInvitationToken: string;
}

export function toInvitationCreatedDto(record: InvitationRecord, rawInvitationToken: string): InvitationCreatedDto {
  return { ...toInvitationDto(record), rawInvitationToken };
}

export interface PairingRequestDto {
  deviceId: string;
  platform: string;
  status: string;
  dskFingerprint: string | null;
  dekFingerprint: string | null;
}

export function toPairingRequestDto(view: PairingRequestView): PairingRequestDto {
  return {
    deviceId: view.deviceId,
    platform: view.platform,
    status: view.status,
    dskFingerprint: view.dskFingerprint,
    dekFingerprint: view.dekFingerprint,
  };
}

export interface BootstrapResultDto {
  deviceId: string;
  status: string;
}

export function toBootstrapResultDto(result: { deviceId: string; status: string }): BootstrapResultDto {
  return { deviceId: result.deviceId, status: result.status };
}
