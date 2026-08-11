import type { DeviceStatusClient } from '../interfaces';
import type { DeviceProtectionStatus } from '../../domain/types';
import { DEV_DEVICE_STATUS } from './fixtures';

const delay = (ms = 100) => new Promise((r) => setTimeout(r, ms));

/** DEVELOPMENT_ONLY fixture implementation of DeviceStatusClient. */
export class DevDeviceStatusClient implements DeviceStatusClient {
  async listDeviceStatuses(childId?: string): Promise<DeviceProtectionStatus[]> {
    await delay();
    return childId ? DEV_DEVICE_STATUS.filter((d) => d.childId === childId) : DEV_DEVICE_STATUS;
  }

  async getDeviceStatus(deviceId: string): Promise<DeviceProtectionStatus | null> {
    await delay();
    return DEV_DEVICE_STATUS.find((d) => d.deviceId === deviceId) ?? null;
  }
}
