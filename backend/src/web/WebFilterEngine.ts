import { resolveClassifierOutcome, resolveWebRuleSource } from './policy.js';
import type {
  CanonicalDomain,
  ClassifierResult,
  OpaqueFamilyId,
  VpnMetadataDecision,
  WebDecision,
  WebRuleSource,
} from './types.js';
import type { WebRuleRepository } from './WebRuleStore.js';

const REASON_CODES: Record<string, string> = {
  SECURITY_DENYLIST: 'blocked by a security threat rule',
  PARENT_ALLOWLIST: 'allowed by your family\'s allow list',
  PARENT_DENYLIST: 'blocked by your family\'s block list',
  CATEGORY_RULE: 'blocked by your family\'s content category rule',
  SCHEDULE_RULE: 'blocked by your family\'s schedule rule',
  CLASSIFIER: 'blocked by your family\'s explicit-content rule',
  DEFAULT: 'no matching rule; allowed by default',
  VPN_UNAVAILABLE: 'network filtering capability was unavailable for this request',
};

/**
 * doc 14's deterministic decision pipeline (steps B through I), implemented
 * as pure orchestration over injected ports -- this class holds no state of
 * its own. `classifierResult` is optional and, per doc 14 step F, only
 * meaningful when the domain was rendered in the PCA Safe Browser; callers
 * outside that context must omit it rather than pass a stale/irrelevant
 * result. `vpnDecision` is optional and reflects doc 14 layer 2 -- when
 * present with outcome UNAVAILABLE, this engine still evaluates rules but
 * never claims network-layer coverage it did not have (see coverage field).
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
  ): Promise<WebDecision> {
    const matched = await this.rules.findMatching(familyId, domain);
    const winner = resolveWebRuleSource(matched);
    if (winner !== null) {
      return {
        domain,
        outcome: winner.listType === 'ALLOW' ? 'ALLOW' : 'BLOCK',
        source: winner.source,
        reasonCode: REASON_CODES[winner.source as WebRuleSource],
        coverage: 'DOMAIN_ONLY',
      };
    }

    if (options.classifierResult) {
      const outcome = resolveClassifierOutcome(options.classifierResult);
      if (outcome !== 'ALLOW') {
        return {
          domain,
          outcome,
          source: 'CLASSIFIER',
          reasonCode: REASON_CODES.CLASSIFIER,
          coverage: 'FULL_URL',
        };
      }
    }

    if (options.vpnDecision && options.vpnDecision.domain === domain) {
      if (options.vpnDecision.outcome === 'BLOCKED') {
        return {
          domain,
          outcome: 'BLOCK',
          source: 'DEFAULT',
          reasonCode: REASON_CODES.PARENT_DENYLIST,
          coverage: options.vpnDecision.coverage === 'DESTINATION_ONLY' ? 'DESTINATION_ONLY' : 'DOMAIN_ONLY',
        };
      }
      if (options.vpnDecision.outcome === 'UNAVAILABLE') {
        return {
          domain,
          outcome: 'ALLOW',
          source: 'DEFAULT',
          reasonCode: REASON_CODES.VPN_UNAVAILABLE,
          coverage: 'DOMAIN_ONLY',
        };
      }
    }

    return {
      domain,
      outcome: 'ALLOW',
      source: 'DEFAULT',
      reasonCode: REASON_CODES.DEFAULT,
      coverage: 'DOMAIN_ONLY',
    };
  }
}
