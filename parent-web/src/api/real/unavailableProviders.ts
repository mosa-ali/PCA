// Explicit "not-ready" implementations of the interfaces this repository
// slice has no real HTTP/relay-backed implementation for yet. Constructed
// ONLY by buildRealClients() (see ../client.ts) when demo mode is off --
// every method here honestly rejects/denies rather than fabricating
// fixture-shaped data, so the UI can render a real UNAVAILABLE state
// instead of a working-looking demo. See KNOWN_BACKEND_INTEGRATION_ACTION
// notes in ../client.ts for what a future real implementation replaces
// each of these with.
import type {
  DeviceStatusClient,
  FamilyAuthorityGateway,
  ParentFamilyDataGateway,
  RequestClient,
  WellbeingMessageAdminClient,
} from '../interfaces';
import type {
  AppRule,
  AuditEntrySummary,
  DashboardSnapshot,
  DeviceProtectionStatus,
  EyeProtectionStatus,
  FamilyMember,
  FamilyRequest,
  LocationStatus,
  PrayerSettings,
  RequestStatus,
  ScreenTimeStatus,
  WebProtectionStatus,
  YouTubeStatus,
} from '../../domain/types';
import type { FamilyAction, FamilyRole, PermissionResult } from '../../domain/roles';
import type { CuratedSuggestion, WellbeingCustomMessage, WellbeingMessageControlV1 } from '../../domain/wellbeing';
import type { TrustedBrowserProvider, TrustedBrowserSnapshot } from '../../domain/trustedBrowser';
import type {
  CiphertextEnvelope,
  ConnectionStatus,
  ParentRuntimeSyncClient,
  PendingDeliveryStatus,
  QueuedEnvelopeStatus,
} from '../runtimeSyncClient';
import { ServiceUnavailableError } from '../unavailable';

/**
 * Fail-closed placeholder for ParentFamilyDataGateway. Every read/write
 * rejects -- callers already route errors through useAsync/try-catch, so
 * this surfaces as an honest error state rather than empty or fabricated
 * family data.
 */
export class UnavailableParentFamilyDataGateway implements ParentFamilyDataGateway {
  getDashboard(): Promise<DashboardSnapshot> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getDashboard'));
  }
  getScreenTime(_childId: string): Promise<ScreenTimeStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getScreenTime'));
  }
  updateScreenTime(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.updateScreenTime'));
  }
  getAppRules(_childId: string): Promise<AppRule[]> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getAppRules'));
  }
  updateAppRule(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.updateAppRule'));
  }
  getWebProtection(_childId: string): Promise<WebProtectionStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getWebProtection'));
  }
  getYouTubeStatus(_childId: string): Promise<YouTubeStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getYouTubeStatus'));
  }
  getLocationStatus(_childId: string): Promise<LocationStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getLocationStatus'));
  }
  getEyeProtectionStatus(_childId: string): Promise<EyeProtectionStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getEyeProtectionStatus'));
  }
  getPrayerSettings(_childId: string): Promise<PrayerSettings> {
    return Promise.reject(new ServiceUnavailableError('ParentFamilyDataGateway.getPrayerSettings'));
  }
}

/**
 * Fail-closed placeholder for FamilyAuthorityGateway. checkPermission
 * returns an explicit denial (never throws) so callers using the standard
 * PermissionResult contract (e.g. useFamilyAction) deny by default without
 * needing special-case error handling -- this must never be mistaken for
 * "allowed". Every other (mutating) method throws, since there is no
 * "denied" shape for them to honestly return.
 */
export class UnavailableFamilyAuthorityGateway implements FamilyAuthorityGateway {
  async checkPermission(_action: FamilyAction): Promise<PermissionResult> {
    return {
      allowed: false,
      reason:
        'Family-authority service is unavailable (no real backend implementation yet in this repository slice) -- ' +
        'denying by default rather than granting on an unavailable dependency.',
    };
  }
  listMembers(): Promise<FamilyMember[]> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.listMembers'));
  }
  inviteMember(): Promise<{ invitationId: string }> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.inviteMember'));
  }
  removeMember(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.removeMember'));
  }
  changeRole(_memberId: string, _newRole: FamilyRole): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.changeRole'));
  }
  transferOwnership(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.transferOwnership'));
  }
  listAuditTrail(): Promise<AuditEntrySummary[]> {
    return Promise.reject(new ServiceUnavailableError('FamilyAuthorityGateway.listAuditTrail'));
  }
}

/** Fail-closed placeholder for DeviceStatusClient -- rejects rather than reporting a fabricated device state. */
export class UnavailableDeviceStatusClient implements DeviceStatusClient {
  listDeviceStatuses(_childId?: string): Promise<DeviceProtectionStatus[]> {
    return Promise.reject(new ServiceUnavailableError('DeviceStatusClient.listDeviceStatuses'));
  }
  getDeviceStatus(_deviceId: string): Promise<DeviceProtectionStatus | null> {
    return Promise.reject(new ServiceUnavailableError('DeviceStatusClient.getDeviceStatus'));
  }
}

/** Fail-closed placeholder for RequestClient. */
export class UnavailableRequestClient implements RequestClient {
  listRequests(_status?: RequestStatus): Promise<FamilyRequest[]> {
    return Promise.reject(new ServiceUnavailableError('RequestClient.listRequests'));
  }
  decide(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('RequestClient.decide'));
  }
}

/** Fail-closed placeholder for WellbeingMessageAdminClient. */
export class UnavailableWellbeingMessageAdminClient implements WellbeingMessageAdminClient {
  getControl(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.getControl'));
  }
  listCuratedSuggestions(_category?: string): Promise<CuratedSuggestion[]> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.listCuratedSuggestions'));
  }
  setCuratedSuggestionEnabled(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.setCuratedSuggestionEnabled'));
  }
  createCustomMessage(
    _message: Omit<WellbeingCustomMessage, 'messageId' | 'createdAtUtc' | 'updatedAtUtc'>,
  ): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.createCustomMessage'));
  }
  updateCustomMessage(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.updateCustomMessage'));
  }
  duplicateCurated(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.duplicateCurated'));
  }
  archiveCustomMessage(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.archiveCustomMessage'));
  }
  restoreCustomMessage(): Promise<WellbeingMessageControlV1> {
    return Promise.reject(new ServiceUnavailableError('WellbeingMessageAdminClient.restoreCustomMessage'));
  }
}

const UNAVAILABLE_TRUSTED_BROWSER_SNAPSHOT: TrustedBrowserSnapshot = {
  // REVOKED is the most restrictive legal state in the existing state
  // machine (../../domain/trustedBrowser.ts) -- it already blocks both
  // sensitive mutations (useFamilyAction's EPOCH_BLOCKING_STATES) and reads
  // that gate on TRUSTED. Reusing it (rather than inventing a new,
  // undocumented "UNAVAILABLE" trust state) keeps every existing
  // fail-closed check correct without adding a second state model.
  state: 'REVOKED',
  serviceAuthenticated: false,
  browserEndpointId: null,
  trustSetEpoch: null,
  acceptedMinEpoch: null,
  pairingRequestedAtUtc: null,
  lastFingerprint: null,
};

/**
 * Fail-closed placeholder for TrustedBrowserProvider. getSnapshot never
 * throws (many callers just render/gate on the returned state) but always
 * reports the most restrictive real state (REVOKED) so nothing downstream
 * can mistake "we don't have a real pairing backend" for "this browser is
 * trusted". Every pairing-flow mutation throws.
 */
export class UnavailableTrustedBrowserProvider implements TrustedBrowserProvider {
  async getSnapshot(): Promise<TrustedBrowserSnapshot> {
    return UNAVAILABLE_TRUSTED_BROWSER_SNAPSHOT;
  }
  beginServiceAuthentication(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.beginServiceAuthentication'));
  }
  requestPairing(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.requestPairing'));
  }
  simulateParentApproval(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.simulateParentApproval'));
  }
  simulateEpochGoneStale(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.simulateEpochGoneStale'));
  }
  simulateRevoke(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.simulateRevoke'));
  }
  reset(): Promise<TrustedBrowserSnapshot> {
    return Promise.reject(new ServiceUnavailableError('TrustedBrowserProvider.reset'));
  }
}

/**
 * Fail-closed placeholder for the runtime sync client's real transport (no
 * backend relay exists in this repository slice -- see
 * ../runtimeSyncClient.ts). getConnectionStatus/getLastSuccessfulSync
 * return honest "we don't know" values (UNKNOWN / null) rather than
 * fabricating a healthy-looking connection; every mutating/queue-reading
 * method throws rather than reporting a fabricated queue state.
 */
export class UnavailableRuntimeSyncClient implements ParentRuntimeSyncClient {
  submitCiphertextEnvelope(
    _envelope: Omit<CiphertextEnvelope, 'envelopeId' | 'createdAtUtc'>,
  ): Promise<{ envelopeId: string }> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.submitCiphertextEnvelope'));
  }
  listQueuedForEndpoint(_endpointId: string): Promise<QueuedEnvelopeStatus[]> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.listQueuedForEndpoint'));
  }
  acknowledgeEnvelope(_envelopeId: string): Promise<{ acknowledged: boolean }> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.acknowledgeEnvelope'));
  }
  async getConnectionStatus(): Promise<ConnectionStatus> {
    return { state: 'UNKNOWN', checkedAtUtc: new Date().toISOString() };
  }
  async getLastSuccessfulSync(): Promise<string | null> {
    return null;
  }
  getPendingDeliveryStatus(_endpointId: string): Promise<PendingDeliveryStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.getPendingDeliveryStatus'));
  }
}
