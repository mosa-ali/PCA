import { randomUUID } from 'node:crypto';
import { isBlockRequestable, isPlausiblePageTitle, isPlausibleUrl } from './policy.js';
import type { BlockDecisionId, BlockDecisionState, OpaqueFamilyId, OpaqueProfileId } from './types.js';
import { canonicalizeDomain } from '../web/canonicalize.js';
import type { WebDecision } from '../web/types.js';

/**
 * Local persistence port for Safe Browser block decisions. This is
 * DEVICE-local storage per doc 14's privacy matrix (full URL/title never
 * leaves the child/parent devices) -- only a deterministic in-memory
 * implementation exists here; no MySQL repository is provided, since
 * this module must never centralize readable browsing history server-side.
 */
export interface BlockDecisionStateRepository {
  put(state: BlockDecisionState): Promise<void>;
  get(id: BlockDecisionId): Promise<BlockDecisionState | null>;
  /**
   * parentpanel dashboard support (doc 18 Section 6, WEB_FILTERING card):
   * the most recent decisions for a family, newest first, capped at
   * `limit`. `profileId === null` aggregates every child in the family --
   * there is no readable central child-profile directory anywhere in this
   * codebase to enumerate children by (see
   * childprofiles/ChildProfileMembershipResolver.ts's own doc comment), so
   * a family-wide caller filters on `familyId` alone rather than fanning
   * out one call per child; `profileId` supplied narrows to one child.
   * Every persisted BlockDecisionState is already a BLOCK/REVIEW outcome
   * only (BlockDecisionStateService.record's own doc comment: an ALLOW
   * outcome is never persisted here), so this never needs its own outcome
   * filter.
   */
  listRecentForFamily(familyId: OpaqueFamilyId, profileId: OpaqueProfileId | null, limit: number): Promise<BlockDecisionState[]>;
}

export class InMemoryBlockDecisionStateRepository implements BlockDecisionStateRepository {
  private readonly states = new Map<BlockDecisionId, BlockDecisionState>();

  async put(state: BlockDecisionState): Promise<void> {
    this.states.set(state.id, state);
  }

  async get(id: BlockDecisionId): Promise<BlockDecisionState | null> {
    return this.states.get(id) ?? null;
  }

  async listRecentForFamily(familyId: OpaqueFamilyId, profileId: OpaqueProfileId | null, limit: number): Promise<BlockDecisionState[]> {
    const matches = [...this.states.values()].filter(
      (state) => state.familyId === familyId && (profileId === null || state.profileId === profileId),
    );
    matches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return matches.slice(0, Math.max(0, limit));
  }
}

export type RecordDecisionErrorCode = 'INVALID_URL' | 'INVALID_TITLE' | 'DOMAIN_MISMATCH';

export class SafeBrowserError extends Error {
  readonly code: RecordDecisionErrorCode;
  constructor(code: RecordDecisionErrorCode) {
    super(SAFE_BROWSER_ERROR_MESSAGES[code]);
    this.name = 'SafeBrowserError';
    this.code = code;
  }
}

const SAFE_BROWSER_ERROR_MESSAGES: Record<RecordDecisionErrorCode, string> = {
  INVALID_URL: 'URL is not plausible.',
  INVALID_TITLE: 'Page title is not plausible.',
  DOMAIN_MISMATCH: "The URL's host does not match the decision's canonical domain.",
};

/**
 * Turns a generic web/ WebDecision into a Safe-Browser-local
 * BlockDecisionState carrying the full URL/title doc 14 permits only in
 * this context. Rejects a URL whose host does not canonicalize to the
 * decision's own domain, so a caller can never attach an unrelated URL to
 * someone else's decision record.
 */
export class BlockDecisionStateService {
  private readonly repository: BlockDecisionStateRepository;
  private readonly now: () => Date;

  constructor(repository: BlockDecisionStateRepository, now: () => Date = () => new Date()) {
    this.repository = repository;
    this.now = now;
  }

  async record(
    familyId: OpaqueFamilyId,
    profileId: OpaqueProfileId,
    url: string,
    pageTitle: string | null,
    decision: WebDecision,
  ): Promise<BlockDecisionState> {
    if (!isPlausibleUrl(url)) throw new SafeBrowserError('INVALID_URL');
    if (pageTitle !== null && !isPlausiblePageTitle(pageTitle)) throw new SafeBrowserError('INVALID_TITLE');
    if (canonicalizeDomain(url) !== decision.domain) throw new SafeBrowserError('DOMAIN_MISMATCH');

    const state: BlockDecisionState = {
      id: randomUUID(),
      familyId,
      profileId,
      domain: decision.domain,
      url,
      pageTitle,
      outcome: decision.outcome,
      source: decision.source,
      reasonId: decision.reasonId,
      reasonCode: decision.reasonCode,
      requestable: decision.outcome !== 'ALLOW' && isBlockRequestable(decision.source),
      createdAt: this.now(),
    };
    await this.repository.put(state);
    return state;
  }
}
