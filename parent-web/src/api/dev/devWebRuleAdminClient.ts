import type { WebRuleAdminClient } from '../interfaces';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../../domain/webRulePolicy';
import { validateWebRuleDomain } from '../../domain/webRulePolicy';

const delay = (ms = 150) => new Promise((r) => setTimeout(r, ms));

interface ChildRuleState {
  rules: WebRuleEntry[];
  revision: number;
}

/**
 * DEVELOPMENT_ONLY in-memory fixture -- demonstrates a fully working
 * add/remove round trip so the UI can be built and demoed before the real
 * E2EE family transport exists (doc 34/36's real APPLIED status requires an
 * actual child receipt, which this fixture cannot honestly produce; it
 * reports DELIVERED, never APPLIED, for exactly that reason).
 */
export class DevWebRuleAdminClient implements WebRuleAdminClient {
  private readonly byChild = new Map<string, ChildRuleState>();

  private stateFor(childId: string): ChildRuleState {
    let state = this.byChild.get(childId);
    if (!state) {
      state = { rules: [], revision: 0 };
      this.byChild.set(childId, state);
    }
    return state;
  }

  async listRules(childId: string): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus; revision: number | null }> {
    await delay();
    const state = this.stateFor(childId);
    return { rules: [...state.rules], status: state.revision > 0 ? 'DELIVERED' : 'LOCAL_DRAFT', revision: state.revision > 0 ? state.revision : null };
  }

  async setRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await delay();
    const state = this.stateFor(childId);
    const validation = validateWebRuleDomain(domain, listType, state.rules);
    if (!validation.valid || validation.canonicalDomain === null) {
      throw new Error(`DevWebRuleAdminClient.setRule: invalid domain "${domain}" (${validation.errors.join(', ')})`);
    }
    const withoutExisting = state.rules.filter((r) => !(r.domain === validation.canonicalDomain && r.listType === listType));
    state.rules = [...withoutExisting, { domain: validation.canonicalDomain, listType, createdAtUtc: new Date().toISOString() }];
    state.revision += 1;
    return { rules: [...state.rules], status: 'DELIVERED' };
  }

  async removeRule(childId: string, domain: string, listType: WebRuleListType): Promise<{ rules: WebRuleEntry[]; status: WebRuleDeliveryStatus }> {
    await delay();
    const state = this.stateFor(childId);
    state.rules = state.rules.filter((r) => !(r.domain === domain && r.listType === listType));
    state.revision += 1;
    return { rules: [...state.rules], status: 'DELIVERED' };
  }
}
