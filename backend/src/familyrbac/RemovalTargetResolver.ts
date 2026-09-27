import type { ChildProfileRegistryRepository } from '../childprofiles/ChildProfileRegistryRepository.js';
import type { DeviceProtectionStatusRepository, ProtectionLevel } from '../device/DeviceProtectionStatusRepository.js';
import type { DeviceChildBindingRepository } from '../device/DeviceChildBindingRepository.js';

export type RemovalTargetResolution =
  | {
      readonly outcome: 'RESOLVED';
      readonly familyId: string;
      readonly deviceId: string;
      readonly childProfileId: string;
      /** Latest fresh device-session-authenticated self-report; not hardware attestation. */
      readonly protectionLevel: 'PROTECTED' | 'DEGRADED';
      readonly reportedAt: Date;
    }
  | {
      readonly outcome:
        | 'DEVICE_NOT_FOUND'
        | 'DEVICE_INACTIVE'
        | 'UNBOUND'
        | 'AMBIGUOUS'
        | 'STATUS_UNAVAILABLE'
        | 'STALE'
        | 'NOT_PROTECTIVE';
    };

export interface RemovalTargetResolverOptions {
  readonly maxStalenessMs?: number;
  readonly now?: () => Date;
}

/**
 * Joins a family-scoped enrollment binding to current family membership and
 * a fresh device-reported protection status. All three authorities must agree
 * before a removal target is usable.
 */
export class RemovalTargetResolver {
  private readonly bindings: DeviceChildBindingRepository;
  private readonly memberships: ChildProfileRegistryRepository;
  private readonly protectionStatuses: DeviceProtectionStatusRepository;
  private readonly maxStalenessMs: number;
  private readonly now: () => Date;

  constructor(
    dependencies: {
      readonly bindings: DeviceChildBindingRepository;
      readonly memberships: ChildProfileRegistryRepository;
      readonly protectionStatuses: DeviceProtectionStatusRepository;
    },
    options: RemovalTargetResolverOptions = {},
  ) {
    this.bindings = dependencies.bindings;
    this.memberships = dependencies.memberships;
    this.protectionStatuses = dependencies.protectionStatuses;
    this.maxStalenessMs = options.maxStalenessMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
    if (!Number.isFinite(this.maxStalenessMs) || this.maxStalenessMs < 0) {
      throw new RangeError('maxStalenessMs must be a finite non-negative number');
    }
  }

  async resolveForRemoval(familyId: string, deviceId: string): Promise<RemovalTargetResolution> {
    const binding = await this.bindings.resolveBinding(familyId, deviceId);
    if (binding.outcome !== 'BOUND') return { outcome: binding.outcome };

    const membership = await this.memberships.resolveMembership(familyId, binding.childProfileId);
    if (membership !== 'MEMBER') return { outcome: 'UNBOUND' };

    const report = await this.protectionStatuses.findForDevice(familyId, deviceId);
    if (report === null || report.familyId !== familyId || report.deviceId !== deviceId) {
      return { outcome: 'STATUS_UNAVAILABLE' };
    }

    // updatedAt is the server receipt time for a device self-report. Reject
    // invalid/future timestamps and stale values; none can authorize a target.
    const reportTime = report.updatedAt.getTime();
    const nowTime = this.now().getTime();
    const ageMs = nowTime - reportTime;
    if (!Number.isFinite(reportTime) || !Number.isFinite(nowTime) || ageMs < 0 || ageMs > this.maxStalenessMs) {
      return { outcome: 'STALE' };
    }

    if (report.protectionLevel !== 'PROTECTED' && report.protectionLevel !== 'DEGRADED') {
      return { outcome: 'NOT_PROTECTIVE' };
    }

    return {
      outcome: 'RESOLVED',
      familyId,
      deviceId,
      childProfileId: binding.childProfileId,
      protectionLevel: report.protectionLevel as Extract<ProtectionLevel, 'PROTECTED' | 'DEGRADED'>,
      reportedAt: new Date(reportTime),
    };
  }
}
