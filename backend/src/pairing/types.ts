import type { DeviceId, DeviceStatus, OpaqueFamilyId, Platform } from '../device/types.js';

/**
 * Parent-facing confirmation view. Fingerprints are confirmation material
 * only ("the parent confirmed the device/key material shown by the
 * service") -- this service never becomes the family E2EE trust
 * authority, which remains entirely device-side (doc 09 Section 3.2).
 */
export interface PairingRequestView {
  deviceId: DeviceId;
  familyId: OpaqueFamilyId;
  platform: Platform;
  status: DeviceStatus;
  dskFingerprint: string | null;
  dekFingerprint: string | null;
}
