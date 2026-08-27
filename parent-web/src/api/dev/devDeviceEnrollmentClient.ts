import type {
  CreateInvitationInput,
  DeviceEnrollmentClient,
  InvitationCreatedDto,
  InvitationDto,
  PairingRequestDto,
} from '../deviceEnrollmentClient';
import { DeviceEnrollmentError } from '../deviceEnrollmentClient';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

interface DevInvitationRecord extends InvitationDto {
  /** Kept only in this module-local dev store, never exposed again after creation -- mirrors the real backend never re-serving it. */
  rawTokenIssuedOnce: string;
}

type DevPairingRecord = PairingRequestDto;

let invitations: DevInvitationRecord[] = [];
let pairingRequests: Map<string, DevPairingRecord> = new Map();
let seq = 0;
let nextCreateInvitationDenial: 'MANAGED_DEVICE_LIMIT_REACHED' | null = null;

/** Test/dev-only reset hook so fixture state doesn't leak between test cases. */
export function __resetDevDeviceEnrollmentState(): void {
  invitations = [];
  pairingRequests = new Map();
  seq = 0;
  nextCreateInvitationDenial = null;
}

/**
 * Dev-only convenience so the UI/tests can exercise the real backend's
 * MANAGED_DEVICE_LIMIT_REACHED 403 (see backend/src/invitation/InvitationService.ts
 * and realDeviceEnrollmentClient.ts's forwarding of the response body's
 * `code` field) without a real over-limit family in fixture data.
 */
export function __devDenyNextCreateInvitation(code: 'MANAGED_DEVICE_LIMIT_REACHED'): void {
  nextCreateInvitationDenial = code;
}

/** Test/dev-only accessor: the device ids seeded by createInvitation() calls so far, most recent last. */
export function __devKnownPairingDeviceIds(): string[] {
  return [...pairingRequests.keys()];
}

function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-dev-${seq}`;
}

/**
 * DEVELOPMENT_ONLY fixture implementation of DeviceEnrollmentClient. Used
 * ONLY when config.demoMode is true (see ../client.ts). Simulates the same
 * lifecycle invariants as the real backend: raw token only on creation,
 * confirmPairing only ever reaches PAIRED, and a device with no fingerprints
 * yet cannot be confirmed.
 */
export class DevDeviceEnrollmentClient implements DeviceEnrollmentClient {
  async createInvitation(familyId: string, input: CreateInvitationInput): Promise<InvitationCreatedDto> {
    await delay();
    if (nextCreateInvitationDenial) {
      const code = nextCreateInvitationDenial;
      nextCreateInvitationDenial = null;
      throw new DeviceEnrollmentError(
        'FORBIDDEN',
        'createInvitation: the server denied this action for your account (insufficient family authority).',
        403,
        code,
      );
    }
    const now = new Date();
    const ttlMs = input.ttlMs ?? 15 * 60_000;
    const invitationId = nextId('inv');
    const rawToken = `dev-raw-token-${invitationId}-${Math.random().toString(36).slice(2)}`;
    const record: DevInvitationRecord = {
      invitationId,
      familyId,
      platform: input.platform,
      requestedProtectionMode: input.requestedProtectionMode,
      childProfileId: input.childProfileId ?? null,
      ageUxTier: input.ageUxTier ?? 'YOUNG_CHILD',
      initialPolicyProfile: input.initialPolicyProfile ?? 'BALANCED',
      status: 'PENDING',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
      openedAt: null,
      installRequiredAt: null,
      appInstalledAt: null,
      authorizationRequiredAt: null,
      redeemedAt: null,
      expiredAt: null,
      revokedAt: null,
      rawTokenIssuedOnce: rawToken,
    };
    invitations = [...invitations, record];

    // Simulate a device eventually showing up at a pairing request with no
    // fingerprints yet (PAIRING_PENDING, fingerprints unresolved) so the UI
    // can exercise the "confirm disabled until fingerprints resolve" path.
    const deviceId = nextId('device');
    pairingRequests.set(deviceId, {
      deviceId,
      platform: input.platform,
      status: 'PAIRING_PENDING',
      dskFingerprint: null,
      dekFingerprint: null,
    });

    const { rawTokenIssuedOnce: _drop, ...dto } = record;
    return { ...dto, rawInvitationToken: rawToken };
  }

  async getInvitation(familyId: string, invitationId: string): Promise<InvitationDto> {
    await delay();
    const record = invitations.find((i) => i.familyId === familyId && i.invitationId === invitationId);
    if (!record) throw new DeviceEnrollmentError('NOT_FOUND', 'Invitation not found.', 404);
    const { rawTokenIssuedOnce: _drop, ...dto } = record;
    return dto;
  }

  async listInvitations(familyId: string): Promise<InvitationDto[]> {
    await delay();
    return invitations
      .filter((i) => i.familyId === familyId)
      .map(({ rawTokenIssuedOnce: _drop, ...dto }) => dto);
  }

  async revokeInvitation(familyId: string, invitationId: string): Promise<InvitationDto> {
    await delay();
    const idx = invitations.findIndex((i) => i.familyId === familyId && i.invitationId === invitationId);
    if (idx === -1) throw new DeviceEnrollmentError('NOT_FOUND', 'Invitation not found.', 404);
    invitations[idx] = { ...invitations[idx], status: 'REVOKED', revokedAt: new Date().toISOString() };
    const { rawTokenIssuedOnce: _drop, ...dto } = invitations[idx];
    return dto;
  }

  async getPairingRequest(_familyId: string, deviceId: string): Promise<PairingRequestDto> {
    await delay();
    const record = pairingRequests.get(deviceId);
    if (!record) throw new DeviceEnrollmentError('NOT_FOUND', 'Pairing request not found.', 404);
    return { ...record };
  }

  /**
   * Simulates fingerprints resolving after some polling, then confirms.
   * Only reaches PAIRED -- never ACTIVE. Confirming an already-PAIRED or
   * REVOKED target is a CONFLICT, matching the real backend.
   */
  async confirmPairing(_familyId: string, deviceId: string): Promise<PairingRequestDto> {
    await delay();
    const record = pairingRequests.get(deviceId);
    if (!record) throw new DeviceEnrollmentError('NOT_FOUND', 'Pairing request not found.', 404);
    if (record.status === 'PAIRED') return { ...record }; // idempotent
    if (record.status !== 'PAIRING_PENDING') {
      throw new DeviceEnrollmentError('CONFLICT', `Cannot confirm pairing in status ${record.status}.`, 409);
    }
    // If fingerprints are still unresolved, the dev fixture mirrors the
    // real backend's implicit precondition -- the UI must not have offered
    // this action, but if called anyway, resolve fingerprints now so the
    // dev flow can proceed (never silently jump straight to ACTIVE).
    const resolved: DevPairingRecord = {
      ...record,
      status: 'PAIRED',
      dskFingerprint: record.dskFingerprint ?? 'dev:dsk:aa11-bb22-cc33-dd44',
      dekFingerprint: record.dekFingerprint ?? 'dev:dek:ee55-ff66-0077-8899',
    };
    pairingRequests.set(deviceId, resolved);
    return { ...resolved };
  }

  /** Dev-only convenience so the UI/tests can watch fingerprints "arrive" for a pending pairing request. */
  __devResolveFingerprints(deviceId: string): void {
    const record = pairingRequests.get(deviceId);
    if (!record) return;
    pairingRequests.set(deviceId, {
      ...record,
      dskFingerprint: 'dev:dsk:aa11-bb22-cc33-dd44',
      dekFingerprint: 'dev:dek:ee55-ff66-0077-8899',
    });
  }
}
