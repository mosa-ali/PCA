import type { NewSafeZoneInput, SafeZone, SafeZoneClient, SafeZonePatch } from '../interfaces';

let sequence = 0;
let zones: SafeZone[] = [];

export class DevSafeZoneClient implements SafeZoneClient {
  async list(familyId: string): Promise<SafeZone[]> {
    return zones.filter((zone) => zone.familyId === familyId).map((zone) => ({ ...zone }));
  }

  async create(familyId: string, input: NewSafeZoneInput): Promise<SafeZone> {
    const now = new Date().toISOString();
    const zone: SafeZone = { zoneId: `dev-zone-${++sequence}`, familyId, ...input, enabled: input.enabled ?? true, revision: 1, deliveryState: 'PENDING_OFFLINE', createdAtUtc: now, updatedAtUtc: now };
    zones = [...zones, zone];
    return { ...zone };
  }

  async update(familyId: string, zoneId: string, patch: SafeZonePatch): Promise<SafeZone> {
    const current = zones.find((zone) => zone.familyId === familyId && zone.zoneId === zoneId);
    if (!current) throw new Error('Safe zone not found');
    const updated = { ...current, ...patch, revision: current.revision + 1, deliveryState: 'PENDING_OFFLINE' as const, updatedAtUtc: new Date().toISOString() };
    zones = zones.map((zone) => zone.zoneId === zoneId ? updated : zone);
    return { ...updated };
  }

  async remove(familyId: string, zoneId: string): Promise<void> {
    zones = zones.filter((zone) => !(zone.familyId === familyId && zone.zoneId === zoneId));
  }
}
