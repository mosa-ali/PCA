export type SafeZoneDeliveryState = 'PENDING_OFFLINE' | 'READY';

export interface SafeZone {
  zoneId: string;
  familyId: string;
  childProfileId: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
  revision: number;
  deliveryState: SafeZoneDeliveryState;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface NewSafeZone {
  familyId: string;
  childProfileId: string;
  label: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  enabled: boolean;
}

export interface SafeZonePatch {
  label?: string;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  enabled?: boolean;
}

export class SafeZoneError extends Error {
  constructor(readonly code: 'CHILD_NOT_IN_FAMILY' | 'NOT_FOUND') {
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
