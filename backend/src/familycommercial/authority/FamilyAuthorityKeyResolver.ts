import type { DeviceRepository } from '../../device/DeviceRepository.js';
import type { OpaqueFamilyId } from '../../familytrustset/types.js';

export interface FamilyAuthorityKeyResolver {
  /** Returns true only for an existing, permitted device with the exact active DSK. */
  isActiveDsk(input: {
    familyId: OpaqueFamilyId;
    deviceId: string;
    keyId: string;
    publicKey: string;
  }): Promise<boolean>;
}

/** Production adapter: authority signatures must resolve through the device directory. */
export class DeviceRepositoryFamilyAuthorityKeyResolver implements FamilyAuthorityKeyResolver {
  constructor(private readonly deviceRepository: DeviceRepository) {}

  async isActiveDsk(input: {
    familyId: OpaqueFamilyId;
    deviceId: string;
    keyId: string;
    publicKey: string;
  }): Promise<boolean> {
    const device = await this.deviceRepository.findDeviceForFamily(input.familyId, input.deviceId);
    if (!device || device.status === 'REVOKED') return false;
    const keys = await this.deviceRepository.findKeysByDeviceForFamily(input.familyId, input.deviceId);
    return keys.some((key) =>
      key.keyId === input.keyId &&
      key.keyPurpose === 'DSK' &&
      key.status === 'ACTIVE' &&
      key.publicKey === input.publicKey,
    );
  }
}
