import { BlockDecisionStateService } from './BlockDecisionStateStore.js';
import type { BlockDecisionState, OpaqueFamilyId, OpaqueProfileId } from './types.js';
import { canonicalizeDomain } from '../web/canonicalize.js';
import { resolveEffectiveSafeSearchMode } from '../web/policy.js';
import type { WebFilterEngine } from '../web/WebFilterEngine.js';
import type { ClassifierResult, SafeSearchDirective, SafeSearchMode } from '../web/types.js';
import type { SupportedLocale } from '../i18n/types.js';

export type NavigationOutcome =
  | { status: 'ALLOW'; safeSearchMode: SafeSearchMode }
  | { status: 'BLOCK' | 'REVIEW'; blockDecision: BlockDecisionState };

export type NavigationErrorCode = 'INVALID_URL';

export class NavigationPolicyError extends Error {
  readonly code: NavigationErrorCode;
  constructor(code: NavigationErrorCode) {
    super('URL could not be canonicalized to a domain.');
    this.name = 'NavigationPolicyError';
    this.code = code;
  }
}

/**
 * doc 14's Safe-Browser-specific entry point: runs the shared web/
 * decision pipeline (rules -> optional classifier), applies the doc 14
 * layer-1 SafeSearch directive when the destination search service
 * supports it, and -- only for a BLOCK/REVIEW outcome -- records a local
 * BlockDecisionState carrying the full URL/title this surface alone is
 * permitted to retain (doc 14's visibility matrix). An ALLOW outcome is
 * never persisted here: doc 15 "PCA services do not persist readable
 * app-use timelines" extends to this module -- an allowed page is not
 * itself a retained event, only a block/review decision is.
 *
 * PCA-16A correction (BACKEND_I18N_NOT_WIRED): `locale` is threaded through
 * to WebFilterEngine.decide() from HERE -- the real production boundary
 * where a navigation request is evaluated on behalf of a specific child
 * profile/device, which is where the presentation locale is actually known
 * (the caller resolves it from the requesting device/profile's language
 * preference; this class never guesses or defaults it beyond the explicit
 * fallback below). The resulting `blockDecision.reasonCode` a parent/child
 * sees is genuinely localized end-to-end, not just in an unused helper.
 */
export class SafeBrowserNavigationPolicy {
  private readonly engine: WebFilterEngine;
  private readonly blockDecisions: BlockDecisionStateService;

  constructor(engine: WebFilterEngine, blockDecisions: BlockDecisionStateService) {
    this.engine = engine;
    this.blockDecisions = blockDecisions;
  }

  async evaluateNavigation(
    familyId: OpaqueFamilyId,
    profileId: OpaqueProfileId,
    url: string,
    options: { pageTitle?: string | null; classifierResult?: ClassifierResult; safeSearch?: SafeSearchDirective } = {},
    locale: SupportedLocale = 'en',
  ): Promise<NavigationOutcome> {
    const domain = canonicalizeDomain(url);
    if (domain === null) throw new NavigationPolicyError('INVALID_URL');

    const decision = await this.engine.decide(familyId, domain, { classifierResult: options.classifierResult }, locale);

    if (decision.outcome === 'ALLOW') {
      const safeSearchMode = options.safeSearch ? resolveEffectiveSafeSearchMode(options.safeSearch) : 'OFF';
      return { status: 'ALLOW', safeSearchMode };
    }

    const blockDecision = await this.blockDecisions.record(
      familyId,
      profileId,
      url,
      options.pageTitle ?? null,
      decision,
    );
    return { status: decision.outcome === 'REVIEW' ? 'REVIEW' : 'BLOCK', blockDecision };
  }
}
