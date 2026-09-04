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
  | 'ACKNOWLEDGE_OWN_NOTIFICATION'
  // PCA runtime-sync parent-facing read gap: a PARENT-session-authenticated
  // equivalent of the DEVICE-authenticated `GET /v1/runtime-sync/status`
  // (runtimeSyncRoutes.ts), scoped to one of the caller's own family's
  // devices. Read-only (connection status/last successful sync/pending
  // delivery bookkeeping only -- never ciphertext, never a mutation), so it
  // is gated on the SAME "service account has an ACTIVE family scope"
  // primitive as every read-only operation above, mirroring
  // VIEW_OWN_BILLING_STATUS's own judgment call that a read of one's own
  // family's already-existing state needs no additional Owner-authority
  // gate.
  | 'VIEW_DEVICE_SYNC_STATUS'
  // PPR-2 opaque child-profile membership registry (doc 00 Section 9 change
  // CHG-2026-09-04-01, doc 10 Section 7.1). Same shape as CREATE_INVITATION/
  // LIST_OWN_INVITATIONS: gated on the service account holding an ACTIVE
  // family scope, nothing more -- this layer still cannot distinguish a
  // Family Owner from an Administrator/Viewer service account (the same
  // disclosed KNOWN GAP noted on INITIATE_CHECKOUT above). Neither member
  // touches readable child content; both operate only on the opaque
  // childProfileId/familyId edge.
  | 'CREATE_CHILD_PROFILE'
  | 'LIST_CHILD_PROFILES';

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
