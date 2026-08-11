import { resolveClassifierOutcome, resolveWebRuleSource } from './policy.js';
import type { CanonicalDomain, ClassifierResult, OpaqueFamilyId, VpnMetadataDecision, WebDecision, WebReasonId } from './types.js';
import type { WebRuleRepository } from './WebRuleStore.js';
import { translate } from '../i18n/translate.js';
import type { SupportedLocale } from '../i18n/types.js';

/**
 * doc 14's deterministic decision pipeline (steps B through I), implemented
 * as pure orchestration over injected ports -- this class holds no state of
 * its own. `classifierResult` is optional and, per doc 14 step F, only
 * meaningful when the domain was rendered in the PCA Safe Browser; callers
 * outside that context must omit it rather than pass a stale/irrelevant
 * result. `vpnDecision` is optional and reflects doc 14 layer 2 -- when
 * present with outcome UNAVAILABLE, this engine still evaluates rules but
 * never claims network-layer coverage it did not have (see coverage field).
 *
 * PCA-16A correction (BACKEND_I18N_NOT_WIRED): this class previously held
 * its own local `REASON_CODES: Record<string, string>` English-only map --
 * a SECOND, un-synchronized copy of text that also lived in backend/src/
 * i18n's catalogue. That duplicate has been removed; `reasonCode` is now
 * always resolved via `translate()` against the single i18n catalogue, so
 * an `ar` caller genuinely receives Arabic text through this real
 * production decision path, not just through an unused helper.
 */
export class WebFilterEngine {
  private readonly rules: WebRuleRepository;

  constructor(rules: WebRuleRepository) {
    this.rules = rules;
  }

  async decide(
    familyId: OpaqueFamilyId,
    domain: CanonicalDomain,
    options: { classifierResult?: ClassifierResult; vpnDecision?: VpnMetadataDecision } = {},
    locale: SupportedLocale = 'en',
  ): Promise<WebDecision> {
    const matched = await this.rules.findMatching(familyId, domain);
    const winner = resolveWebRuleSource(matched);
    if (winner !== null) {
      return this.build(domain, winner.listType === 'ALLOW' ? 'ALLOW' : 'BLOCK', winner.source, winner.source, 'DOMAIN_ONLY', locale);
    }

    if (options.classifierResult) {
      const outcome = resolveClassifierOutcome(options.classifierResult);
      if (outcome !== 'ALLOW') {
        return this.build(domain, outcome, 'CLASSIFIER', 'CLASSIFIER', 'FULL_URL', locale);
      }
    }

    if (options.vpnDecision && options.vpnDecision.domain === domain) {
      if (options.vpnDecision.outcome === 'BLOCKED') {
        return this.build(
          domain,
          'BLOCK',
          'DEFAULT',
          'PARENT_DENYLIST',
          options.vpnDecision.coverage === 'DESTINATION_ONLY' ? 'DESTINATION_ONLY' : 'DOMAIN_ONLY',
          locale,
        );
      }
      if (options.vpnDecision.outcome === 'UNAVAILABLE') {
        return this.build(domain, 'ALLOW', 'DEFAULT', 'VPN_UNAVAILABLE', 'DOMAIN_ONLY', locale);
      }
    }

    return this.build(domain, 'ALLOW', 'DEFAULT', 'DEFAULT', 'DOMAIN_ONLY', locale);
  }

  private build(
    domain: CanonicalDomain,
    outcome: WebDecision['outcome'],
    source: WebDecision['source'],
    reasonId: WebReasonId,
    coverage: WebDecision['coverage'],
    locale: SupportedLocale,
  ): WebDecision {
    return {
      domain,
      outcome,
      source,
      reasonId,
      reasonCode: translate(`web.${reasonId}`, locale),
      coverage,
    };
  }
}
