// Explicit "not-ready" implementations of the interfaces this repository
// slice has no real HTTP/relay-backed implementation for yet. Constructed
// ONLY by buildRealClients() (see ../client.ts) when demo mode is off --
// every method here honestly rejects/denies rather than fabricating
// fixture-shaped data, so the UI can render a real UNAVAILABLE state
// instead of a working-looking demo. See KNOWN_BACKEND_INTEGRATION_ACTION
// notes in ../client.ts for what a future real implementation replaces
// each of these with.
//
// NOTE: DeviceStatusClient, ParentFamilyDataGateway, RequestClient,
// TrustedBrowserProvider, and (as of PCA-MYKIDS-BILL-3)
// BillingClient/CommercialNotificationClient now have
// real implementations (see ../real/realParentFamilyDataGateway.ts,
// ../real/realBillingClient.ts, and siblings) -- their Unavailable* classes
// were removed from this file once nothing constructed them anymore, per
// the KNOWN_BACKEND_INTEGRATION_ACTION convention in ../client.ts.
// WellbeingMessageAdminClient is still genuinely unimplemented in this
// repository slice. ParentRuntimeSyncClient was briefly listed above as
// having a real implementation; that was wrong (it targeted `/api/sync/*`,
// a surface this backend never served), and a real-browser sweep caught it
// -- see UnavailableParentRuntimeSyncClient below. FamilyAuthorityGateway is
// now PARTIALLY real: removeMember has a genuine HTTP-backed implementation
// (see ../real/realFamilyAuthorityGateway.ts, which extends
// UnavailableFamilyAuthorityGateway below and overrides only that one
// method) -- every other method on this interface still has no real backend
// counterpart and keeps this class's own honest rejection/denial behavior.
// ParentRuntimeSyncClient is now the SAME kind of PARTIALLY real:
// ../real/realParentRuntimeSyncClient.ts's RealParentRuntimeSyncClient
// extends UnavailableParentRuntimeSyncClient below and overrides only the 3
// read-only bookkeeping methods (getConnectionStatus/getLastSuccessfulSync/
// getPendingDeliveryStatus) against the new
// backend/src/http/routes/parentRuntimeSyncRoutes.ts route -- the mutating
// envelope methods (submitCiphertextEnvelope/listQueuedForEndpoint/
// acknowledgeEnvelope) still have no real backend counterpart (they need
// the not-yet-built, crypto-review-gated parent-sdk E2EE client) and keep
// this class's own honest rejection behavior unchanged.
import type { FamilyAuthorityGateway, WellbeingMessageAdminClient } from '../interfaces';
import type {
  ConnectionStatus,
  CiphertextEnvelope,
  ParentRuntimeSyncClient,
  PendingDeliveryStatus,
  QueuedEnvelopeStatus,
} from '../runtimeSyncClient';
import type { AuditEntrySummary, FamilyMember } from '../../domain/types';
import type { FamilyAction, FamilyRole, PermissionResult } from '../../domain/roles';
import type { CuratedSuggestion, WellbeingCustomMessage, WellbeingMessageControlV1 } from '../../domain/wellbeing';
import { ServiceUnavailableError } from '../unavailable';

/**
 * Fail-closed placeholder for FamilyAuthorityGateway. checkPermission
 * returns an explicit denial (never throws) so callers using the standard
 * PermissionResult contract (e.g. useFamilyAction) deny by default without
 * needing special-case error handling -- this must never be mistaken for
 * "allowed". Every other (mutating) method throws, since there is no
 * "denied" shape for them to honestly return.
 *
 * Also the base class RealFamilyAuthorityGateway extends (see
 * ../real/realFamilyAuthorityGateway.ts) to override ONLY removeMember with
 * a genuine HTTP-backed implementation, while inheriting every other
 * method's honest not-implemented behavior unchanged.
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
  removeMember(_memberId: string): Promise<{ auditEventId: string }> {
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

/**
 * Fail-closed placeholder for ParentRuntimeSyncClient's mutating envelope
 * methods (submitCiphertextEnvelope/listQueuedForEndpoint/
 * acknowledgeEnvelope), and the base class RealParentRuntimeSyncClient
 * (../real/realParentRuntimeSyncClient.ts) extends to inherit exactly that
 * -- overriding only the 3 read-only bookkeeping methods
 * (getConnectionStatus/getLastSuccessfulSync/getPendingDeliveryStatus)
 * against the real backend/src/http/routes/parentRuntimeSyncRoutes.ts route.
 *
 * WHY THIS ONCE COVERED EVERY METHOD. buildRealClients() previously wired a
 * DIFFERENT `RealParentRuntimeSyncClient` in production that targeted
 * `/api/sync/*`, a surface this backend never served at all -- the only
 * runtime-sync API the backend shipped at the time was `/v1/runtime-sync/*`,
 * the DEVICE-facing relay (device challenge/session, inbound/outbound
 * envelopes) authenticated by a device session, a different API with a
 * different shape and a different caller. A Round-2 real-browser sweep
 * proved the consequence: loading /children/:childId/screen-time fired
 * `404 GET /api/sync/last-sync` and `404 GET /api/sync/endpoints/<id>/pending`
 * at a real backend. That was fixed by wiring this class (rejecting every
 * method) instead, exactly like every other not-yet-built port in this file.
 *
 * The mutating envelope methods below still have no real backend
 * counterpart -- they require the parent-sdk's E2EE envelope crypto, gated
 * on a human security review -- and keep rejecting here. Callers already
 * handle ServiceUnavailableError and render an honest unavailable state for
 * them; no capability is fabricated.
 */
export class UnavailableParentRuntimeSyncClient implements ParentRuntimeSyncClient {
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
  getConnectionStatus(): Promise<ConnectionStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.getConnectionStatus'));
  }
  getLastSuccessfulSync(): Promise<string | null> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.getLastSuccessfulSync'));
  }
  getPendingDeliveryStatus(_endpointId: string): Promise<PendingDeliveryStatus> {
    return Promise.reject(new ServiceUnavailableError('ParentRuntimeSyncClient.getPendingDeliveryStatus'));
  }
}
