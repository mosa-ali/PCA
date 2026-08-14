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
// TrustedBrowserProvider and ParentRuntimeSyncClient now have real
// implementations (see ../real/realParentFamilyDataGateway.ts and
// siblings) as part of PCA-PARENT-FAMILY-DATA-1 -- their Unavailable*
// classes were removed from this file once nothing constructed them
// anymore, per the KNOWN_BACKEND_INTEGRATION_ACTION convention in
// ../client.ts. FamilyAuthorityGateway and WellbeingMessageAdminClient are
// still genuinely unimplemented in this repository slice.
import type { BillingClient, FamilyAuthorityGateway, WellbeingMessageAdminClient } from '../interfaces';
import type { AuditEntrySummary, FamilyMember } from '../../domain/types';
import type { FamilyAction, FamilyRole, PermissionResult } from '../../domain/roles';
import type { CuratedSuggestion, WellbeingCustomMessage, WellbeingMessageControlV1 } from '../../domain/wellbeing';
import type { EntitlementChangeRequest, EntitlementSnapshot, Invoice, LimitType, PaymentMethodSummary, SubscriptionSnapshot } from '../../domain/billing';
import { ServiceUnavailableError } from '../unavailable';

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
 * Fail-closed placeholder for BillingClient (PCA-MYKIDS-BILL-1). Confirmed
 * by repository survey: backend/src/http/buildServer.ts registers no
 * entitlement/billing route of any kind, and backend/src/billing/*'s
 * service layer is exclusively Platform-Administration-RBAC-gated (no
 * family-facing read/write path exists even at the service layer for the
 * Invoice/PaymentMethod/Subscription domain). This is a genuine, repository
 * confirmed backend-integration gap (BACKEND_GAP_REQUIRED), not a narrower
 * "payment provider not selected yet" condition -- every method here
 * honestly rejects rather than fabricating an endpoint or fixture-shaped
 * data. isPaymentProviderAvailable() returns false so the UI can disable
 * the checkout action up front instead of only discovering the failure
 * after a click (Section 11 of PCA_ADDENDUM_002 Section 18).
 */
export class UnavailableBillingClient implements BillingClient {
  getEntitlement(): Promise<EntitlementSnapshot> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.getEntitlement'));
  }
  getSubscription(): Promise<SubscriptionSnapshot> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.getSubscription'));
  }
  listInvoices(): Promise<Invoice[]> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.listInvoices'));
  }
  getInvoice(): Promise<Invoice | null> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.getInvoice'));
  }
  listPaymentMethods(): Promise<PaymentMethodSummary[]> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.listPaymentMethods'));
  }
  isPaymentProviderAvailable(): boolean {
    return false;
  }
  requestLimitIncrease(_limitType: LimitType, _targetLimit: number): Promise<EntitlementChangeRequest> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.requestLimitIncrease'));
  }
  cancelRequest(): Promise<EntitlementChangeRequest> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.cancelRequest'));
  }
  beginCheckout(): Promise<EntitlementChangeRequest> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.beginCheckout'));
  }
  getRequest(): Promise<EntitlementChangeRequest | null> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.getRequest'));
  }
  beginAddPaymentMethod(): Promise<PaymentMethodSummary> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.beginAddPaymentMethod'));
  }
  cancelAutoRenew(): Promise<{ auditEventId: string }> {
    return Promise.reject(new ServiceUnavailableError('BillingClient.cancelAutoRenew'));
  }
}
