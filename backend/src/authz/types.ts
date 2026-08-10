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
  | 'LICENSE_LOOKUP'
  | 'RELEASE_METADATA_LOOKUP';

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
