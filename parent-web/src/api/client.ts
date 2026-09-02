// Factory that wires the typed API interfaces to their current
// implementation. Every consumer imports only the interfaces from
// ./interfaces (plus this factory), so swapping implementations never
// requires a UI change.
//
// Two families of implementation exist today:
//  - DEVELOPMENT_ONLY fixtures (src/api/dev/*) -- used ONLY when
//    config.demoMode is explicitly true.
//  - "Real" implementations (src/api/real/*) -- used whenever demo mode is
//    off. These fall into two honest-but-different categories:
//     (a) genuinely HTTP-backed code with no live backend to answer it yet
//         (RealServiceAuthClient) -- same status as before: safe to
//         construct/call, will fail at runtime until a backend exists.
//         RealParentRuntimeSyncClient is now PARTIALLY in this category and
//         partially real: its 3 read-only bookkeeping methods are
//         genuinely HTTP-backed against
//         backend/src/http/routes/parentRuntimeSyncRoutes.ts, while its
//         mutating envelope methods (inherited from
//         UnavailableParentRuntimeSyncClient) still have no real backend
//         counterpart -- see that class's own file header.
//     (b) trusted-browser E2EE family-content providers
//         (RealTrustedBrowserProvider, RealParentFamilyDataGateway,
//         RealDeviceStatusClient, RealRequestClient) -- these perform real
//         local WebCrypto (endpoint key generation) and real trust-state
//         checks, but are additionally gated on
//         @pca/parent-sdk-browser-runtime's crypto-review gate, which is
//         hardcoded not-ready until a human security review approves the
//         production E2EE suite (see that package's src/cryptoGate.ts).
//         Until then they honestly reject with EndpointNotTrustedError or
//         CryptoReviewRequiredError rather than ever fabricating family
//         data -- see src/api/real/realParentFamilyDataGateway.ts.
//    For familyAuthority and wellbeingMessages, no real implementation
//    exists yet in this repository slice at all, so an explicit
//    "unavailable" provider (src/api/real/unavailableProviders.ts) is used.
//    Those providers never fabricate fixture data and never grant
//    permissions -- they surface a genuine UNAVAILABLE/NOT_IMPLEMENTED
//    condition to the UI. This is deliberately NOT the same thing as
//    falling back to fixtures: a real-but-not-yet-implemented backend must
//    never masquerade as a working demo.
//
// KNOWN_BACKEND_INTEGRATION_ACTION: as each remaining interface in
// src/api/real/unavailableProviders.ts gets a genuine HTTP/relay-backed
// implementation, replace its construction below the same way the others
// already are, and delete the corresponding Unavailable* class once nothing
// constructs it anymore.
import { config } from '../config/env';
import type {
  BillingClient,
  CommercialNotificationClient,
  DeviceStatusClient,
  FamilyAuditDeliveryClient,
  ProtectionAlertDeliveryClient,
  FamilyAuthorityGateway,
  FamilyMemberInvitationClient,
  FreeAccessStatusClient,
  ParentPreferencesClient,
  SafeZoneClient,
  ParentFamilyDataGateway,
  RequestClient,
  RetentionClient,
  ServiceAuthClient,
  WebRuleAdminClient,
  WellbeingMessageAdminClient,
} from './interfaces';
import type { ParentRuntimeSyncClient } from './runtimeSyncClient';
import type { TrustedBrowserProvider } from '../domain/trustedBrowser';
import type { DeviceEnrollmentClient } from './deviceEnrollmentClient';
import { DevServiceAuthClient } from './dev/devServiceAuthClient';
import { DevFamilyAuthorityGateway } from './dev/devFamilyAuthorityGateway';
import { DevParentFamilyDataGateway } from './dev/devParentFamilyDataGateway';
import { DevDeviceStatusClient } from './dev/devDeviceStatusClient';
import { DevRequestClient } from './dev/devRequestClient';
import { DevWellbeingMessageAdminClient } from './dev/devWellbeingMessageAdminClient';
import { DevWebRuleAdminClient } from './dev/devWebRuleAdminClient';
import { DevTrustedBrowserProvider } from './dev/devTrustedBrowserProvider';
import { DevRuntimeSyncClient } from './dev/devRuntimeSyncClient';
import { DevDeviceEnrollmentClient } from './dev/devDeviceEnrollmentClient';
import { DevBillingClient } from './dev/devBillingClient';
import { DevCommercialNotificationClient } from './dev/devCommercialNotificationClient';
import { DevFreeAccessStatusClient } from './dev/devFreeAccessStatusClient';
import { DevParentPreferencesClient } from './dev/devParentPreferencesClient';
import { DevSafeZoneClient } from './dev/devSafeZoneClient';
import { RealServiceAuthClient } from './real/realServiceAuthClient';
import { RealTrustedBrowserProvider } from './real/realTrustedBrowserProvider';
import { RealParentFamilyDataGateway } from './real/realParentFamilyDataGateway';
import { RealDeviceStatusClient } from './real/realDeviceStatusClient';
import { RealRequestClient } from './real/realRequestClient';
import { RealDeviceEnrollmentClient, noServiceBearerTokenAvailable as noDeviceEnrollmentBearerTokenAvailable } from './real/realDeviceEnrollmentClient';
import { RealWebRuleAdminClient } from './real/realWebRuleAdminClient';
import { RealBillingClient, cookieSessionFamilyId } from './real/realBillingClient';
import { RealCommercialNotificationClient } from './real/realCommercialNotificationClient';
import { RealFreeAccessStatusClient } from './real/realFreeAccessStatusClient';
import { RealParentPreferencesClient } from './real/realParentPreferencesClient';
import { RealSafeZoneClient } from './real/realSafeZoneClient';
import { RealFamilyAuthorityGateway } from './real/realFamilyAuthorityGateway';
import { RealParentRuntimeSyncClient } from './real/realParentRuntimeSyncClient';
import { UnavailableSafeZonePolicyAuthoring, type SafeZonePolicyAuthoring } from './safeZonePolicyAuthoring';
import { RealSchedulePolicyClient } from './real/realSchedulePolicyClient';
import { UnavailableSchedulePolicyAuthoring, type SchedulePolicyAuthoring } from './schedulePolicyAuthoring';
import { RealRetentionClient, noServiceBearerTokenAvailable as noRetentionBearerTokenAvailable } from './real/realRetentionClient';
import { DevRetentionClient } from './dev/devRetentionClient';
import { RealFamilyMemberInvitationClient } from './real/realFamilyMemberInvitationClient';
import { DevFamilyMemberInvitationClient } from './dev/devFamilyMemberInvitationClient';
import { RealFamilyAuditDeliveryClient } from './real/realFamilyAuditDeliveryClient';
import { DevFamilyAuditDeliveryClient } from './dev/devFamilyAuditDeliveryClient';
import { UnavailableFamilyAuditEnvelopeDecryptionBoundary } from './familyAuditDecryption';
import { RealProtectionAlertDeliveryClient } from './real/realProtectionAlertDeliveryClient';
import { DevProtectionAlertDeliveryClient } from './dev/devProtectionAlertDeliveryClient';
import { UnavailableWellbeingMessageAdminClient } from './real/unavailableProviders';

export interface PcaApiClients {
  serviceAuth: ServiceAuthClient;
  /**
   * removeMember is real, HTTP-backed against
   * backend/src/http/routes/familyMemberRoutes.ts's remove route outside
   * demo mode -- every other method (checkPermission/listMembers/
   * inviteMember/changeRole/transferOwnership/listAuditTrail) is still
   * genuinely unimplemented in this repository slice; see
   * ./real/realFamilyAuthorityGateway.ts's own header for exactly why and
   * for the known useFamilyAction/checkPermission pre-flight gap that
   * currently still stands between this route and the Members.tsx UI in
   * production.
   */
  familyAuthority: FamilyAuthorityGateway;
  /**
   * PCA product-completion programme, Writer P0-C (family/members): real,
   * HTTP-backed against backend/src/http/routes/familyMemberRoutes.ts
   * outside demo mode -- same actor-device-session-token/trust-set external
   * gate as `requests`/`safeZones` above (see ./real/realFamilyMemberInvitationClient.ts's
   * header). Genuinely separate from `familyAuthority` -- see
   * FamilyMemberInvitationClient's own doc comment in interfaces.ts.
   */
  familyMemberInvitations: FamilyMemberInvitationClient;
  /**
   * PCA product-completion programme, Writer P0-D (/security/audit): real,
   * HTTP-backed against backend/src/http/routes/familyAuditEventRoutes.ts
   * outside demo mode -- same actor-device-session-token/crypto-boundary
   * external gate as `safeZones`/`schedulePolicyAuthoring` above. Genuinely
   * separate from `familyAuthority.listAuditTrail` (still unimplemented) --
   * see AuditTrailFeedResult's own doc comment in interfaces.ts.
   */
  familyAuditDelivery: FamilyAuditDeliveryClient;
  /**
   * PCA product-completion programme (/security/status): real, HTTP-backed
   * against backend/src/http/routes/protectionAlertRoutes.ts outside demo
   * mode -- same actor-device-session-token external gate as
   * `familyAuditDelivery` above. Genuinely separate from that interface --
   * see ProtectionAlertFeedResult's own doc comment in interfaces.ts.
   */
  protectionAlertDelivery: ProtectionAlertDeliveryClient;
  parentFamilyData: ParentFamilyDataGateway;
  deviceStatus: DeviceStatusClient;
  requests: RequestClient;
  wellbeingMessages: WellbeingMessageAdminClient;
  webRuleAdmin: WebRuleAdminClient;
  trustedBrowser: TrustedBrowserProvider;
  runtimeSync: ParentRuntimeSyncClient;
  deviceEnrollment: DeviceEnrollmentClient;
  /**
   * PCA-MYKIDS-BILL-3: real, HTTP-backed against MYKIDS_COMMERCIAL_API_V1
   * (backend/src/http/routes/familyCommercialRoutes.ts +
   * billingCheckoutRoutes.ts) outside demo mode, over the browser's
   * existing `pca_family_session` HttpOnly cookie with a double-submit CSRF
   * header on mutations. Its remaining honestly-surfaced gap is
   * actorDeviceId (DEVICE_IDENTITY_UNAVAILABLE until requestPairing() has
   * run), not the session transport.
   */
  billing: BillingClient;
  /** PCA-MYKIDS-BILL-3: real, HTTP-backed against the family-facing commercial-notification routes outside demo mode. Same cookie-session transport as `billing` above. */
  commercialNotifications: CommercialNotificationClient;
  /**
   * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61): real, cookie-session-
   * backed against GET /api/parent/free-access-status outside demo mode --
   * the same `pca_family_session` cookie `serviceAuth`, `billing`,
   * `deviceEnrollment` and `retention` all rely on.
   */
  freeAccessStatus: FreeAccessStatusClient;
  parentPreferences: ParentPreferencesClient;
  safeZones: SafeZoneClient;
  safeZonePolicyAuthoring: SafeZonePolicyAuthoring;
  schedulePolicyAuthoring: SchedulePolicyAuthoring;
  /**
   * PCA-FR-093: real, HTTP-backed against
   * backend/src/http/routes/retentionRoutes.ts outside demo mode, over the
   * same cookie-session transport as `billing` above -- see
   * ./real/realRetentionClient.ts's header. Reads (getDefaults) work for
   * any signed-in family session; writes additionally pass through the
   * client-side ../rbac/useFamilyAction pre-gate, which is the only WHO
   * control for these operations because retentionRoutes deliberately
   * performs no server-side role check.
   */
  retention: RetentionClient;
  /** True only when DEVELOPMENT_ONLY fixtures are actually in use (config.demoMode === true). Never true as a side effect of a real-client construction failure. */
  isFixtureBacked: boolean;
}

function buildDevClients(): PcaApiClients {
  return {
    serviceAuth: new DevServiceAuthClient(),
    familyAuthority: new DevFamilyAuthorityGateway(),
    familyMemberInvitations: new DevFamilyMemberInvitationClient(),
    familyAuditDelivery: new DevFamilyAuditDeliveryClient(),
    protectionAlertDelivery: new DevProtectionAlertDeliveryClient(),
    parentFamilyData: new DevParentFamilyDataGateway(),
    deviceStatus: new DevDeviceStatusClient(),
    requests: new DevRequestClient(),
    wellbeingMessages: new DevWellbeingMessageAdminClient(),
    webRuleAdmin: new DevWebRuleAdminClient(),
    trustedBrowser: new DevTrustedBrowserProvider(),
    runtimeSync: new DevRuntimeSyncClient(),
    deviceEnrollment: new DevDeviceEnrollmentClient(),
    billing: new DevBillingClient(),
    commercialNotifications: new DevCommercialNotificationClient(),
    freeAccessStatus: new DevFreeAccessStatusClient(),
    parentPreferences: new DevParentPreferencesClient(),
    safeZones: new DevSafeZoneClient(),
    safeZonePolicyAuthoring: new UnavailableSafeZonePolicyAuthoring('ENCRYPTION_UNAVAILABLE'),
    schedulePolicyAuthoring: new UnavailableSchedulePolicyAuthoring('ENCRYPTION_UNAVAILABLE'),
    retention: new DevRetentionClient(),
    isFixtureBacked: true,
  };
}

/**
 * Builds the strongest actually-available real implementation for each
 * interface. serviceAuth is genuinely HTTP-backed and reachable today --
 * it is never discarded just because sibling interfaces aren't implemented
 * yet. Every not-yet-implemented interface gets an explicit "unavailable"
 * provider (see src/api/real/unavailableProviders.ts), never a fixture.
 * Deliberately has no try/catch: if constructing any of these ever throws
 * (a genuine programmer error, not an expected condition), that must
 * propagate to the caller rather than being swallowed -- see
 * getApiClients() below and src/components/common/AppErrorBoundary.tsx for
 * where that surfaces.
 */
function buildRealClients(): PcaApiClients {
  // trustedBrowser is constructed first and shared with the family-content
  // gateways below (parentFamilyData/deviceStatus/requests) -- they all
  // check the SAME trust snapshot, so "trusted" can never mean something
  // different to one gateway than another.
  const trustedBrowser = new RealTrustedBrowserProvider(config.apiBaseUrl);
  // Constructed once and shared with parentFamilyData below: it is the
  // single source of the REAL recipient device id
  // (DeviceProtectionStatus.deviceId) that the gateway addresses policy
  // envelopes to and that the UI passes to runtimeSync -- see
  // ./real/realParentFamilyDataGateway.ts's resolveChildDeviceId.
  const deviceStatus = new RealDeviceStatusClient(trustedBrowser);
  return {
    serviceAuth: new RealServiceAuthClient(config.apiBaseUrl),
    // PCA product-completion programme: removeMember is now real, HTTP-backed
    // against backend/src/http/routes/familyMemberRoutes.ts's remove route
    // (see ./real/realFamilyAuthorityGateway.ts's own header) -- every other
    // method on this interface (checkPermission/listMembers/inviteMember/
    // changeRole/transferOwnership/listAuditTrail) still has no real backend
    // counterpart in this repository slice, so RealFamilyAuthorityGateway
    // extends UnavailableFamilyAuthorityGateway and inherits their existing
    // honest rejection/denial behavior unchanged.
    familyAuthority: new RealFamilyAuthorityGateway(config.apiBaseUrl, trustedBrowser),
    familyMemberInvitations: new RealFamilyMemberInvitationClient(config.apiBaseUrl, trustedBrowser),
    familyAuditDelivery: new RealFamilyAuditDeliveryClient(config.apiBaseUrl, trustedBrowser, new UnavailableFamilyAuditEnvelopeDecryptionBoundary()),
    protectionAlertDelivery: new RealProtectionAlertDeliveryClient(config.apiBaseUrl, trustedBrowser),
    parentFamilyData: new RealParentFamilyDataGateway(
      trustedBrowser,
      new UnavailableSchedulePolicyAuthoring('CRYPTO_REVIEW_REQUIRED'),
      new RealSchedulePolicyClient(config.apiBaseUrl, trustedBrowser),
      config.apiBaseUrl,
      undefined,
      deviceStatus,
    ),
    deviceStatus,
    requests: new RealRequestClient(config.apiBaseUrl, trustedBrowser),
    wellbeingMessages: new UnavailableWellbeingMessageAdminClient(),
    webRuleAdmin: new RealWebRuleAdminClient(config.apiBaseUrl, trustedBrowser),
    trustedBrowser,
    // Real, HTTP-backed against the parent-facing
    // backend/src/http/routes/parentRuntimeSyncRoutes.ts route for its 3
    // read-only bookkeeping methods (getConnectionStatus/
    // getLastSuccessfulSync/getPendingDeliveryStatus) -- reuses the SAME
    // pca_family_session cookie/`/api/parent/session` family-resolution
    // billing/commercialNotifications already rely on (cookieSessionFamilyId,
    // ./real/realBillingClient.ts). The mutating envelope methods
    // (submitCiphertextEnvelope/listQueuedForEndpoint/acknowledgeEnvelope)
    // remain genuinely unimplemented -- see
    // ./real/realParentRuntimeSyncClient.ts's own header for why (the
    // not-yet-built, crypto-review-gated parent-sdk E2EE client) and
    // KNOWN_BACKEND_INTEGRATION_ACTION above.
    runtimeSync: new RealParentRuntimeSyncClient(config.apiBaseUrl, () => cookieSessionFamilyId(config.apiBaseUrl)),
    // Browser device enrollment authenticates with the SAME
    // `pca_family_session` HttpOnly cookie `serviceAuth` already relies on:
    // backend/src/auth/fastifyAuthPlugin.ts's requireServiceSession accepts
    // either that cookie or an `Authorization: Bearer` header, and
    // invitationRoutes/pairingRoutes sit behind it (see
    // ./real/realDeviceEnrollmentClient.ts's header). Mutations carry the
    // double-submit CSRF header. The bearer accessor stays wired as the
    // explicit non-browser fallback and is never consulted in cookie mode.
    // invitationRoutes additionally enforces family authorization, so a
    // caller without it now receives that route's own honest 403 instead of
    // a client-side excuse the server never issued.
    deviceEnrollment: new RealDeviceEnrollmentClient(config.apiBaseUrl, noDeviceEnrollmentBearerTokenAvailable, true),
    // Browser billing uses the existing HttpOnly family-session cookie and
    // resolves family scope through /api/parent/session. Mutations carry the
    // non-HttpOnly CSRF token; actorDeviceId reuses
    // TrustedBrowserProvider's browserEndpointId (this
    // codebase's only existing device-identity concept; billing routes do
    // not themselves require E2EE trust, so this is a pragmatic reuse, not
    // a claim that billing depends on the crypto-review gate) -- resolves
    // to null until requestPairing() has run at least once, at which point
    // RealBillingClient honestly rejects mutating calls with
    // DEVICE_IDENTITY_UNAVAILABLE rather than sending an empty/fabricated id.
    billing: new RealBillingClient(config.apiBaseUrl, undefined, () => cookieSessionFamilyId(config.apiBaseUrl), async () => {
      const snapshot = await trustedBrowser.getSnapshot();
      return snapshot.browserEndpointId;
    }, true),
    commercialNotifications: new RealCommercialNotificationClient(config.apiBaseUrl, undefined, () => cookieSessionFamilyId(config.apiBaseUrl), true),
    freeAccessStatus: new RealFreeAccessStatusClient(config.apiBaseUrl),
    parentPreferences: new RealParentPreferencesClient(config.apiBaseUrl),
    safeZones: new RealSafeZoneClient(config.apiBaseUrl, trustedBrowser),
    safeZonePolicyAuthoring: new UnavailableSafeZonePolicyAuthoring('CRYPTO_REVIEW_REQUIRED'),
    schedulePolicyAuthoring: new UnavailableSchedulePolicyAuthoring('CRYPTO_REVIEW_REQUIRED'),
    // Browser retention uses the same cookie transport as billing above:
    // backend/src/http/routes/retentionRoutes.ts sits behind the same
    // requireServiceSession that accepts the `pca_family_session` cookie,
    // and family scope resolves through /api/parent/session
    // (cookieSessionFamilyId), not a second mechanism. Mutations carry the
    // double-submit CSRF header. The bearer/no-family placeholders stay
    // wired as the explicit non-browser fallbacks and are never consulted in
    // cookie mode. NOTE: retentionRoutes performs NO server-side role check
    // (deliberately -- see its own createRequireActiveFamilyScope doc
    // comment), so the client-side ../rbac/useFamilyAction pre-gate remains
    // the only control over WHO may perform retention writes and must not be
    // relaxed; retention READS (getDefaults) do not go through it.
    retention: new RealRetentionClient(config.apiBaseUrl, noRetentionBearerTokenAvailable, () => cookieSessionFamilyId(config.apiBaseUrl), true),
    isFixtureBacked: false,
  };
}

let cached: PcaApiClients | null = null;

/**
 * Demo-mode fixtures are constructed ONLY when config.demoMode is
 * explicitly true. There is deliberately no catch-all here: a construction
 * failure while demo mode is off is a real defect and must be visible (see
 * AppErrorBoundary), never silently masked by a working-looking fixture
 * bundle. Callers that need resilience against a specific interface being
 * unavailable should handle that interface's typed error, not rely on this
 * factory to hide it.
 */
export function getApiClients(): PcaApiClients {
  if (cached) return cached;
  cached = config.demoMode ? buildDevClients() : buildRealClients();
  return cached;
}
