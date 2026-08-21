// Real (non-fixture) RequestClient. Same crypto-gated pattern as
// RealParentFamilyDataGateway -- see that file's header comment. Family
// requests (bonus-time, unblock, etc.) contain child-identifying reason
// text and are therefore treated as family content requiring decryption,
// not server-visible metadata.
import type { FamilyRequest, RequestStatus } from '../../domain/types';
import type { RequestClient } from '../interfaces';
import type { TrustedBrowserProvider } from '../../domain/trustedBrowser';
import { localFamilyDataStore, type LocalFamilyDataStore } from '../../security/localFamilyDataStore';
import { requireTrustedAndCryptoReady } from './familyDataGate';

export class RealRequestClient implements RequestClient {
  constructor(
    private readonly trustedBrowser: TrustedBrowserProvider,
    private readonly store: LocalFamilyDataStore = localFamilyDataStore,
  ) {}

  async listRequests(status?: RequestStatus): Promise<FamilyRequest[]> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.listRequests');
    const record = this.store.get<FamilyRequest[]>('familyRequests');
    const all = record?.data ?? [];
    return status ? all.filter((r) => r.status === status) : all;
  }

  async decide(): Promise<{ auditEventId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.decide');
    throw new Error('RequestClient.decide: mutation path not implemented yet even post-crypto-approval.');
  }

  /** PCA-FR-130 "grant directly" -- same not-implemented-yet posture as decide() above; see this file's header comment. */
  async grantBonusTime(): Promise<{ auditEventId: string; requestId: string }> {
    await requireTrustedAndCryptoReady(this.trustedBrowser, 'RequestClient.grantBonusTime');
    throw new Error('RequestClient.grantBonusTime: mutation path not implemented yet even post-crypto-approval.');
  }
}
