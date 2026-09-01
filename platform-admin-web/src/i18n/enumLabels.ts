// The single place that turns a backend enum value into the label an OPERATOR
// reads. Every one of these renders a real i18n key and falls back to the raw
// code, never to a missing-key string.
//
// Why a fallback at all: these vocabularies live in the backend and can gain a
// value before this app ships a label for it (the audit event-type list is
// explicitly documented as future-proofed with types no code emits yet, and an
// entitlement tier is typed as a bare `string`, so plan refs are an OPEN set).
// Showing the raw code in that case is honest and still useful to an operator;
// inventing a friendly label for a value this app does not know would not be.
//
// This mirrors the label-map convention the app already uses for
// `audit.results.*`, `accounts.statuses.*`, `roles.*`, `settings.markets.*`
// and `settings.categories.*`.
import type { TFunction } from 'i18next';

/**
 * A Platform Administration audit event type
 * (backend/src/platformadmin/audit/types.ts's closed
 * PLATFORM_ADMIN_AUDIT_EVENT_TYPES vocabulary).
 */
export function auditEventTypeLabel(t: TFunction, eventType: string): string {
  return t(`audit.eventTypes.${eventType}`, { defaultValue: eventType });
}

/** A Platform Administration role (`roles.*`, the same keys the shell header uses). */
export function adminRoleLabel(t: TFunction, role: string): string {
  return t(`roles.${role}`, { defaultValue: role });
}

/**
 * An entitlement plan/tier reference. OPEN set: EntitlementDefaultsRecord.tier
 * is a plain `string`, so only tiers this app has a label for are translated
 * and any other ref is shown exactly as the backend reported it.
 */
export function planRefLabel(t: TFunction, planRef: string): string {
  return t(`accounts.plans.${planRef}`, { defaultValue: planRef });
}
