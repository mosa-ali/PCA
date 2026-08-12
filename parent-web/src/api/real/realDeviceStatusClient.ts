// Real (non-fixture) DeviceStatusClient. Same crypto-gated pattern as
// RealParentFamilyDataGateway -- see that file's header comment.
import type { DeviceProtectionStatus } from '../../domain/types';
import type { DeviceStatusClient } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireTrustedAndCryptoReady } from './familyDataGate';

export class RealDeviceStatusClient implements DeviceStatusClient {
  constructor(
    private readonly trustedBrowser: TrustedBrowserProvider,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
  ) {}

  async listDeviceStatuses(childId?: string): Promise<DeviceProtectionStatus[]> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'DeviceStatusClient.listDeviceStatuses');
    const record = this.store.get<DeviceProtectionStatus[]>('deviceStatuses');
    const all = record?.data ?? [];
    return childId ? all.filter((d) => d.childId === childId) : all;
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceProtectionStatus | null> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'DeviceStatusClient.getDeviceStatus');
    const record = this.store.get<DeviceProtectionStatus[]>('deviceStatuses');
    return record?.data.find((d) => d.deviceId === deviceId) ?? null;
  }
}
