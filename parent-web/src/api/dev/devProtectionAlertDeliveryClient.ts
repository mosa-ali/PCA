// DEVELOPMENT_ONLY fixture implementation of ProtectionAlertDeliveryClient.
// Demo mode has no real crypto gate to simulate honestly (see
// DevFamilyAuditDeliveryClient's own precedent: "answers with a working
// in-memory fixture") -- this returns DEV_PROTECTION_ALERTS as an
// already-READY feed, never a fabricated PENDING_TRUSTED_DECRYPTION state.
import type { ProtectionAlertDeliveryClient, ProtectionAlertFeedResult } from '../interfaces';
import type { ParentProtectionAlert } from '../../pages/security/ProtectionAlertPanel';
import { DEV_PROTECTION_ALERTS } from './fixtures';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export class DevProtectionAlertDeliveryClient implements ProtectionAlertDeliveryClient {
  async list(): Promise<ProtectionAlertFeedResult> {
    await delay();
    const alerts: ParentProtectionAlert[] = [...DEV_PROTECTION_ALERTS];
    return { status: 'READY', alerts };
  }
}
