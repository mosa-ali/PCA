import { beforeEach, describe, expect, it } from 'vitest';
import {
  DevDeviceEnrollmentClient,
  __resetDevDeviceEnrollmentState,
  __devKnownPairingDeviceIds,
} from '../../src/api/dev/devDeviceEnrollmentClient';

describe('DevDeviceEnrollmentClient (DEVELOPMENT_ONLY fixture)', () => {
  let client: DevDeviceEnrollmentClient;

  beforeEach(() => {
    __resetDevDeviceEnrollmentState();
    client = new DevDeviceEnrollmentClient();
  });

  it('createInvitation returns a raw token, and getInvitation/listInvitations never return it again', async () => {
    const created = await client.createInvitation('fam-1', {
      platform: 'ANDROID',
      requestedProtectionMode: 'ANDROID_STANDARD',
    });
    expect(created.rawInvitationToken).toBeTruthy();

    const fetched = await client.getInvitation('fam-1', created.invitationId);
    expect(fetched).not.toHaveProperty('rawInvitationToken');

    const listed = await client.listInvitations('fam-1');
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty('rawInvitationToken');
  });

  it('revokeInvitation marks the invitation REVOKED', async () => {
    const created = await client.createInvitation('fam-1', {
      platform: 'ANDROID',
      requestedProtectionMode: 'ANDROID_STANDARD',
    });
    const revoked = await client.revokeInvitation('fam-1', created.invitationId);
    expect(revoked.status).toBe('REVOKED');
    expect(revoked.revokedAt).not.toBeNull();
  });

  it('getInvitation/revokeInvitation throw NOT_FOUND for an unknown invitation', async () => {
    await expect(client.getInvitation('fam-1', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(client.revokeInvitation('fam-1', 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('creating an invitation produces a pairing request that starts PAIRING_PENDING with no fingerprints', async () => {
    await client.createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
    const [deviceId] = __devKnownPairingDeviceIds();
    const view = await client.getPairingRequest('fam-1', deviceId);
    expect(view.status).toBe('PAIRING_PENDING');
    expect(view.dskFingerprint).toBeNull();
    expect(view.dekFingerprint).toBeNull();
  });

  it('confirmPairing only ever resolves to PAIRED, never ACTIVE, and is idempotent', async () => {
    await client.createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
    const [deviceId] = __devKnownPairingDeviceIds();

    const confirmed = await client.confirmPairing('fam-1', deviceId);
    expect(confirmed.status).toBe('PAIRED');
    expect(confirmed.status).not.toBe('ACTIVE');
    expect(confirmed.dskFingerprint).toBeTruthy();
    expect(confirmed.dekFingerprint).toBeTruthy();

    // Idempotent: confirming again returns the same PAIRED state, not an error.
    const confirmedAgain = await client.confirmPairing('fam-1', deviceId);
    expect(confirmedAgain.status).toBe('PAIRED');
  });

  it('confirmPairing rejects a device id that was never paired-requested', async () => {
    await expect(client.confirmPairing('fam-1', 'never-existed')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('__devResolveFingerprints lets fingerprints "arrive" for a still-pending pairing request', async () => {
    await client.createInvitation('fam-1', { platform: 'ANDROID', requestedProtectionMode: 'ANDROID_STANDARD' });
    const [deviceId] = __devKnownPairingDeviceIds();
    let view = await client.getPairingRequest('fam-1', deviceId);
    expect(view.dskFingerprint).toBeNull();

    client.__devResolveFingerprints(deviceId);
    view = await client.getPairingRequest('fam-1', deviceId);
    expect(view.status).toBe('PAIRING_PENDING');
    expect(view.dskFingerprint).toBeTruthy();
    expect(view.dekFingerprint).toBeTruthy();
  });
});
