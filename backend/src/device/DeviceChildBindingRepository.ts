import { execute, runInTransaction } from '../db/pool.js';

/** Result of resolving the durable enrollment-attempt -> invitation -> child edge. */
export type DeviceChildBindingOutcome =
  | { readonly outcome: 'BOUND'; readonly childProfileId: string }
  | { readonly outcome: 'DEVICE_NOT_FOUND' }
  | { readonly outcome: 'DEVICE_INACTIVE' }
  | { readonly outcome: 'UNBOUND' }
  | { readonly outcome: 'AMBIGUOUS' };

/** Read-only, family-scoped lookup. Implementations must never infer a child from request data. */
export interface DeviceChildBindingRepository {
  resolveBinding(familyId: string, deviceId: string): Promise<DeviceChildBindingOutcome>;
}

interface DeviceChildBindingRow {
  device_id: string;
  device_family_id: string;
  device_platform: string;
  device_status: string;
  attempt_family_id: string | null;
  invitation_id: string | null;
  invitation_family_id: string | null;
  child_profile_id: string | null;
}

/**
 * Resolves only the existing durable enrollment chain:
 * devices -> enrollment_bootstrap_attempts -> enrollment_invitations.
 *
 * The query intentionally reads no child content. The membership registry is
 * checked separately by the consumer because the invitation's child ID is a
 * soft reference there. Browser endpoints and legacy/null-profile invitations
 * have no usable child binding and fail closed as UNBOUND.
 */
export class MySqlDeviceChildBindingRepository implements DeviceChildBindingRepository {
  async resolveBinding(familyId: string, deviceId: string): Promise<DeviceChildBindingOutcome> {
    const { rows } = await runInTransaction((conn) =>
      execute<DeviceChildBindingRow>(
        conn,
        `SELECT d.device_id,
                d.family_id AS device_family_id,
                d.platform AS device_platform,
                d.status AS device_status,
                a.family_id AS attempt_family_id,
                a.invitation_id,
                i.family_id AS invitation_family_id,
                i.child_profile_id
           FROM devices d
           LEFT JOIN enrollment_bootstrap_attempts a ON a.device_id = d.device_id
           LEFT JOIN enrollment_invitations i ON i.invitation_id = a.invitation_id
          WHERE d.device_id = ? AND d.family_id = ?
          ORDER BY a.attempt_id ASC`,
        [deviceId, familyId],
      ),
    );

    if (rows.length === 0) return { outcome: 'DEVICE_NOT_FOUND' };

    const first = rows[0]!;
    if (first.device_family_id !== familyId || first.device_id !== deviceId) {
      return { outcome: 'DEVICE_NOT_FOUND' };
    }
    if (first.device_status !== 'ACTIVE') return { outcome: 'DEVICE_INACTIVE' };
    if (first.device_platform !== 'ANDROID' && first.device_platform !== 'IOS') {
      return { outcome: 'UNBOUND' };
    }

    const childIds = new Set<string>();
    for (const row of rows) {
      // Family disagreement, missing joins, or a null legacy profile makes
      // the relationship unusable even if another row appears resolvable.
      if (
        row.device_id !== deviceId ||
        row.device_family_id !== familyId ||
        row.device_status !== 'ACTIVE' ||
        row.device_platform !== 'ANDROID' && row.device_platform !== 'IOS' ||
        row.attempt_family_id !== familyId ||
        row.invitation_id === null ||
        row.invitation_family_id !== familyId ||
        row.child_profile_id === null
      ) {
        return { outcome: 'UNBOUND' };
      }
      childIds.add(row.child_profile_id);
    }

    if (childIds.size === 0) return { outcome: 'UNBOUND' };
    if (childIds.size > 1) return { outcome: 'AMBIGUOUS' };
    return { outcome: 'BOUND', childProfileId: childIds.values().next().value! };
  }
}
