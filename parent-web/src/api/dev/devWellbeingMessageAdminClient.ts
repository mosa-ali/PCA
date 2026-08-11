import type { WellbeingMessageAdminClient } from '../interfaces';
import type { CuratedSuggestion, WellbeingCustomMessage, WellbeingMessageControlV1 } from '../../domain/wellbeing';
import { evaluatePermission } from '../../domain/roles';
import { DEV_CURATED_SUGGESTIONS, DEV_WELLBEING_CONTROL } from './fixtures';
import { getDevRole } from './devState';

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));
let control: WellbeingMessageControlV1 = structuredClone(DEV_WELLBEING_CONTROL);

function assertCanManage() {
  const permission = evaluatePermission(getDevRole(), 'MANAGE_WELLBEING_MESSAGES');
  if (!permission.allowed) throw new Error(permission.reason);
}

function bump(): WellbeingMessageControlV1 {
  control = { ...control, policyRevision: control.policyRevision + 1, updatedAtUtc: new Date().toISOString() };
  return control;
}

/** DEVELOPMENT_ONLY fixture implementation of WellbeingMessageAdminClient. */
export class DevWellbeingMessageAdminClient implements WellbeingMessageAdminClient {
  async getControl(): Promise<WellbeingMessageControlV1> {
    await delay();
    return control;
  }

  async listCuratedSuggestions(category?: string): Promise<CuratedSuggestion[]> {
    await delay();
    return category ? DEV_CURATED_SUGGESTIONS.filter((c) => c.category === category) : DEV_CURATED_SUGGESTIONS;
  }

  async setCuratedSuggestionEnabled(curatedId: string, enabled: boolean): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    const set = new Set(control.selectedCuratedSuggestionIds);
    if (enabled) set.add(curatedId);
    else set.delete(curatedId);
    control = { ...control, selectedCuratedSuggestionIds: [...set] };
    return bump();
  }

  async createCustomMessage(
    message: Omit<WellbeingCustomMessage, 'messageId' | 'createdAtUtc' | 'updatedAtUtc'>,
  ): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    const now = new Date().toISOString();
    const created: WellbeingCustomMessage = {
      ...message,
      messageId: `custom-${Date.now()}`,
      createdAtUtc: now,
      updatedAtUtc: now,
    };
    control = { ...control, customMessages: [...control.customMessages, created] };
    return bump();
  }

  async updateCustomMessage(messageId: string, patch: Partial<WellbeingCustomMessage>): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    control = {
      ...control,
      customMessages: control.customMessages.map((m) =>
        m.messageId === messageId ? { ...m, ...patch, updatedAtUtc: new Date().toISOString() } : m,
      ),
    };
    return bump();
  }

  async duplicateCurated(curatedId: string): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    const source = DEV_CURATED_SUGGESTIONS.find((c) => c.curatedId === curatedId);
    if (!source) throw new Error('Curated suggestion not found');
    const now = new Date().toISOString();
    const duplicate: WellbeingCustomMessage = {
      messageId: `custom-${Date.now()}`,
      sourceCuratedId: source.curatedId,
      languageTexts: source.languageTexts,
      category: source.category,
      enabled: true,
      archived: false,
      startDate: null,
      endDate: null,
      daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
      timeWindows: [],
      triggers: source.recommendedTriggers,
      minimumIntervalMinutes: 60,
      maximumPerDay: 3,
      repeatCooldownMinutes: 1440,
      lockScreenAllowed: false,
      dismissible: true,
      snoozable: true,
      requiresAdultSupervision: source.requiresAdultSupervision,
      targetChildIds: [],
      createdAtUtc: now,
      updatedAtUtc: now,
    };
    control = { ...control, customMessages: [...control.customMessages, duplicate] };
    return bump();
  }

  async archiveCustomMessage(messageId: string): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    control = {
      ...control,
      customMessages: control.customMessages.map((m) => (m.messageId === messageId ? { ...m, archived: true } : m)),
    };
    return bump();
  }

  async restoreCustomMessage(messageId: string): Promise<WellbeingMessageControlV1> {
    assertCanManage();
    await delay();
    control = {
      ...control,
      customMessages: control.customMessages.map((m) => (m.messageId === messageId ? { ...m, archived: false } : m)),
    };
    return bump();
  }
}
