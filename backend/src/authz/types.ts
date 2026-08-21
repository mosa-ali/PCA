export type ServiceAccountId = string;
export type OpaqueFamilyId = string;

/**
 * Server operations this authorization layer may ever gate. Deliberately
 * does NOT include POLICY_UPDATE, FAMILY_ROLE_CHANGE, RETENTION_CONTROL,
 * ALLOW_CHILD_REMOVAL, or FAMILY_ACTIVITY_READ -- those can never be
 * authorized by a service session alone, so there is no enum member (and
 * therefore no code path) for them here. Adding one would itself be the
 * violation this module exists to prevent.
 *
 * Also deliberately excludes device/child enrollment bootstrap: a child
 * claiming an invitation has no parent service session to authenticate
 * with (it authenticates only as the one-time invitation bearer, entirely
 * outside AuthzService) -- see EnrollmentCoordinator. Adding an
 * ENROLLMENT_BOOTSTRAP member here would wrongly imply bootstrap needs, or
 * could be gated by, a parent's service-account/family-scope authority.
 */
export type ServiceOperation =
  | 'CREATE_INVITATION'
  | 'VIEW_INVITATION_STATUS'
  | 'REVOKE_INVITATION'
  | 'LIST_OWN_INVITATIONS'
  | 'VIEW_PAIRING_REQUEST'
  | 'CONFIRM_PAIRING_REQUEST'
  /** PCA-FR-063/doc 08 Section 8-style ceremony: registers a service-authenticated browser's non-extractable DSK as a new BROWSER-platform device. Confirmation still goes through the existing CONFIRM_PAIRING_REQUEST/pairing-requests flow -- registration is a distinct, narrower operation. */
  | 'REGISTER_BROWSER_ENDPOINT'
  | 'LICENSE_LOOKUP'
  | 'RELEASE_METADATA_LOOKUP'
  // PCA-BILL-2A: family-facing billing checkout/status operations, added
  // additively (no existing member removed or renamed). Both are gated on
  // the SAME "service account has an ACTIVE family scope" primitive as
  // every operation above -- see checkoutRoutes.ts's own header comment
  // for the disclosed KNOWN GAP this implies: this layer cannot
  // distinguish a Family Owner from a family-scoped Administrator/Viewer
  // service account (that distinction is device-plane/E2EE-envelope-only
  // today, backend/src/familyrbac/TrustSetRoleResolver.ts, unreachable
  // from ordinary parent-web HTTP) -- true Family-Owner-only enforcement
  // per PCA-ADD-BILL-040 is NOT closed by this lane; it remains
  // PCA-MYKIDS-BILL-1's scope.
  | 'INITIATE_CHECKOUT'
  | 'VIEW_OWN_BILLING_STATUS'
  // PCA-COMMERCIAL-NOTIFY-1: family-facing commercial-notification
  // read/acknowledge operations, added additively (no existing member
  // removed or renamed). Gated on the SAME "service account has an ACTIVE
  // family scope" primitive as every operation above.
  | 'VIEW_OWN_NOTIFICATIONS'
  | 'ACKNOWLEDGE_OWN_NOTIFICATION';

export type ScopeStatus = 'ACTIVE' | 'REVOKED';

/**
 * "This account may perform service-plane operations for this opaque
 * family reference." Nothing more -- no role, no family activity, no
 * policy authority.
 */
export interface FamilyScopeRecord {
  accountId: ServiceAccountId;
  familyId: OpaqueFamilyId;
  status: ScopeStatus;
  createdAt: Date;
}

export interface AuthorizationContext {
  accountId: ServiceAccountId;
  operation: ServiceOperation;
  familyId?: OpaqueFamilyId;
}
