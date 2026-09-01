// Guards the "no raw user-facing enum" property for the Platform Admin console.
//
// The audit table already translated its `result` column and the shell header
// already rendered `roles.APP_OWNER` as "App Owner", but the same table printed
// `eventType` and `actorRole` as raw backend codes, and the accounts Plan
// column and settings copy printed the raw tier code `FREE_STARTER`. These
// tests pin the labels and, most importantly, pin the audit event-type key set
// against the BACKEND's authoritative closed vocabulary so the two cannot
// drift apart silently.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../../src/i18n';
import { adminRoleLabel, auditEventTypeLabel, planRefLabel } from '../../src/i18n/enumLabels';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT_TYPES_TS = resolve(HERE, '../../../backend/src/platformadmin/audit/types.ts');

/** The backend's closed vocabulary, read from its single source of truth. */
function backendAuditEventTypes(): string[] {
  const src = readFileSync(AUDIT_TYPES_TS, 'utf8');
  const block = src
    .split('export const PLATFORM_ADMIN_AUDIT_EVENT_TYPES = [')[1]
    .split('] as const;')[0];
  return [...block.matchAll(/'([A-Z0-9_]+)'/g)].map((m) => m[1]);
}

const ARABIC = /[؀-ۿ]/;
const RAW_ENUM = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

describe('platform-admin enum labels', () => {
  it('every backend audit event type has an EN and AR label', () => {
    const types = backendAuditEventTypes();
    expect(types.length).toBeGreaterThan(20);
    for (const type of types) {
      const enLabel = (en.audit.eventTypes as Record<string, string>)[type];
      const arLabel = (ar.audit.eventTypes as Record<string, string>)[type];
      expect(enLabel, `EN label for ${type}`).toBeTruthy();
      expect(arLabel, `AR label for ${type}`).toBeTruthy();
      // A label that is still the code itself would defeat the whole point.
      expect(RAW_ENUM.test(enLabel), `${type} EN label must not be a raw code`).toBe(false);
      expect(ARABIC.test(arLabel), `${type} AR label must be Arabic`).toBe(true);
    }
  });

  it('carries no label for an event type the backend does not define', () => {
    const types = new Set(backendAuditEventTypes());
    for (const key of Object.keys(en.audit.eventTypes)) {
      expect(types.has(key), `${key} is labelled but not in the backend vocabulary`).toBe(true);
    }
  });

  it('translates known audit event types and admin roles', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(auditEventTypeLabel(t, 'ADMIN_LOGIN')).toBe('Admin sign-in');
    expect(auditEventTypeLabel(t, 'SETTLEMENT_BATCH_CREATED')).toBe('Settlement batch created');
    // The same key the shell header already used for this value.
    expect(adminRoleLabel(t, 'APP_OWNER')).toBe('App Owner');
    expect(adminRoleLabel(t, 'FINANCE_ADMIN')).toBe(en.roles.FINANCE_ADMIN);
  });

  it('translates a known plan ref and falls back to the raw ref for an unknown one', async () => {
    await i18n.changeLanguage('en');
    const t = i18n.t.bind(i18n);
    expect(planRefLabel(t, 'FREE_STARTER')).toBe('Free Starter');
    // Plan refs are an OPEN set (the backend types tier as a bare string), so an
    // unrecognised ref must show verbatim -- never a missing-key string and
    // never an invented label.
    expect(planRefLabel(t, 'SOME_FUTURE_TIER')).toBe('SOME_FUTURE_TIER');
    expect(auditEventTypeLabel(t, 'SOME_FUTURE_EVENT')).toBe('SOME_FUTURE_EVENT');
    expect(adminRoleLabel(t, 'SOME_FUTURE_ROLE')).toBe('SOME_FUTURE_ROLE');
  });

  it('renders Arabic labels under the Arabic locale', async () => {
    await i18n.changeLanguage('ar');
    const t = i18n.t.bind(i18n);
    expect(ARABIC.test(auditEventTypeLabel(t, 'ADMIN_LOGIN'))).toBe(true);
    expect(ARABIC.test(adminRoleLabel(t, 'APP_OWNER'))).toBe(true);
    expect(ARABIC.test(planRefLabel(t, 'FREE_STARTER'))).toBe(true);
    await i18n.changeLanguage('en');
  });

  it('the settings tier copy interpolates the plan label instead of hardcoding the code', () => {
    for (const [name, bundle] of [['en', en], ['ar', ar]] as const) {
      for (const key of ['freeStarterTitle', 'defaultsNotConfigured', 'defaultsSaved'] as const) {
        const value = (bundle.settings as Record<string, string>)[key];
        expect(value, `${name}.settings.${key}`).toContain('{{plan}}');
        expect(value, `${name}.settings.${key}`).not.toContain('FREE_STARTER');
      }
    }
  });
});
