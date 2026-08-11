import { randomUUID } from 'node:crypto';
import { isBlockRequestable, isPlausiblePageTitle, isPlausibleUrl } from './policy.js';
import type { BlockDecisionId, BlockDecisionState, OpaqueFamilyId, OpaqueProfileId } from './types.js';
import { canonicalizeDomain } from '../web/canonicalize.js';
import type { WebDecision } from '../web/types.js';

/**
 * Local persistence port for Safe Browser block decisions. This is
 * DEVICE-local storage per doc 14's privacy matrix (full URL/title never
 * leaves the child/parent devices) -- only a deterministic in-memory
 * implementation exists here; no PostgreSQL repository is provided, since
 * this module must never centralize readable browsing history server-side.
 */
export interface BlockDecisionStateRepository {
  put(state: BlockDecisionState): Promise<void>;
  get(id: BlockDecisionId): Promise<BlockDecisionState | null>;
}

export class InMemoryBlockDecisionStateRepository implements BlockDecisionStateRepository {
  private readonly states = new Map<BlockDecisionId, BlockDecisionState>();

  async put(state: BlockDecisionState): Promise<void> {
    this.states.set(state.id, state);
  }

  async get(id: BlockDecisionId): Promise<BlockDecisionState | null> {
    return this.states.get(id) ?? null;
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
