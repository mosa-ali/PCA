export type SafeZoneDeliveryState = 'PENDING_OFFLINE' | 'READY';

export interface SafeZone {
  zoneId: string;
  familyId: string;
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
  revision: number;
  deliveryState: SafeZoneDeliveryState;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface NewSafeZone {
  familyId: string;
  recipientEndpointId: string;
  ciphertextB64: string;
  nonceB64: string;
  keyEpoch: number;
}

export interface SafeZonePatch {
  ciphertextB64?: string;
  nonceB64?: string;
  keyEpoch?: number;
}

export class SafeZoneError extends Error {
  constructor(readonly code: 'NOT_FOUND') {
    super(code);
    this.name = 'SafeZoneError';
  }
}

export interface SafeZoneRepository {
  list(familyId: string): Promise<SafeZone[]>;
  create(input: NewSafeZone): Promise<SafeZone>;
  update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone>;
  remove(familyId: string, zoneId: string): Promise<boolean>;
}
