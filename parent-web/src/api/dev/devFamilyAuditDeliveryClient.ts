// DEVELOPMENT_ONLY fixture implementation of FamilyAuditDeliveryClient.
// Demo mode has no real crypto gate to simulate honestly (see
// DevRetentionClient's own precedent: "answers with a working in-memory
// fixture") -- this returns the same DEV_AUDIT fixture data
// DevFamilyAuthorityGateway.listAuditTrail() already exposes, as an
// already-READY feed, never a fabricated PENDING_TRUSTED_DECRYPTION state.
import type { AuditEntrySummary } from '../../domain/types';
import type { AuditTrailFeedResult, FamilyAuditDeliveryClient } from '../interfaces';
import { DEV_AUDIT } from './fixtures';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export class DevFamilyAuditDeliveryClient implements FamilyAuditDeliveryClient {
  async list(): Promise<AuditTrailFeedResult> {
    await delay();
    const entries: AuditEntrySummary[] = [...DEV_AUDIT];
    return { status: 'READY', entries };
  }
}
