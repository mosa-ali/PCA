import type { CanonicalDomain, WebDecisionOutcome, WebRuleSource } from '../web/types.js';

export type OpaqueFamilyId = string;
export type OpaqueProfileId = string;
export type BlockDecisionId = string;
export type UnblockRequestId = string;

/**
 * doc 14's visibility matrix, PCA Safe Browser row: "Full URL/title only
 * under local retention policy; decision reason/source." A BlockDecisionState
 * is the local record of one navigation decision made inside the Safe
 * Browser -- `url`/`pageTitle` are only ever populated here (never in the
 * generic web/ module, which only ever sees a canonical domain) because the
 * Safe Browser is doc 14's "only normal path in which PCA can intentionally
 * observe a full URL, page title and rendered content locally."
 */
export interface BlockDecisionState {
  id: BlockDecisionId;
  familyId: OpaqueFamilyId;
  profileId: OpaqueProfileId;
  domain: CanonicalDomain;
  url: string;
  pageTitle: string | null;
  outcome: WebDecisionOutcome;
  source: WebRuleSource | 'CLASSIFIER' | 'DEFAULT';
  reasonCode: string;
  /** doc 14: "The child can request a review" -- false for a non-overridable security block (see safebrowser/policy.ts). */
  requestable: boolean;
  createdAt: Date;
}

export type ParentUnblockRequestStatus = 'PENDING' | 'APPROVED_TEMPORARY' | 'APPROVED_PERMANENT' | 'DENIED';

/**
 * doc 14: "the parent receives a minimally descriptive request and can
 * allow a site temporarily or permanently." One request always traces back
 * to the specific BlockDecisionState the child was shown -- never a bare
 * domain string -- so the parent's decision context matches exactly what
 * the child saw.
 */
export interface ParentUnblockRequest {
  id: UnblockRequestId;
  blockDecisionId: BlockDecisionId;
  familyId: OpaqueFamilyId;
  profileId: OpaqueProfileId;
  domain: CanonicalDomain;
  status: ParentUnblockRequestStatus;
  requestedAt: Date;
  decidedAt: Date | null;
  /** Set only when status is APPROVED_TEMPORARY. */
  temporaryApprovalExpiresAt: Date | null;
}
