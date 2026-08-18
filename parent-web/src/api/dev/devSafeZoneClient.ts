import type { NewSafeZoneInput, SafeZone, SafeZoneClient, SafeZonePatch } from '../interfaces';

let zones: SafeZone[] = [];

export class DevSafeZoneClient implements SafeZoneClient {
  async list(familyId: string): Promise<SafeZone[]> {
    return zones.filter((zone) => zone.familyId === familyId).map((zone) => ({ ...zone }));
  }

  async create(familyId: string, input: NewSafeZoneInput): Promise<SafeZone> {
    void familyId;
    void input;
    throw new Error('SAFE_ZONE_ENCRYPTION_UNAVAILABLE');
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    void familyId;
    void zoneId;
    void patch;
    throw new Error('SAFE_ZONE_ENCRYPTION_UNAVAILABLE');
  }

  async remove(familyId: string, zoneId: string): Promise<void> {
    zones = zones.filter((zone) => !(zone.familyId === familyId && zone.zoneId === zoneId));
  }
}
