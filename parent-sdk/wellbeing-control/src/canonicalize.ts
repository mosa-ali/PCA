/**
 * Deterministic canonical byte representation of a WellbeingMessageControlV1
 * policy document, for consistent hashing/signing when embedded in the
 * existing family envelope. This is a client-domain canonical form only --
 * it is not the wire serialization (doc 22 stays representation-neutral on
 * that choice) and it selects no cryptographic suite.
 *
 * Fields are netstring length-prefixed (`${byteLength}:${value}`) and
 * concatenated in a fixed order, matching the convention used by
 * backend/src/familyenvelope/canonicalize.ts, so that no field value can be
 * crafted to make two different logical policy documents canonicalize to
 * the same byte string, and so JSON key ordering is never load-bearing.
 *
 * Every user-authored free-text field (custom message title/body, per
 * language variant) is normalized to Unicode NFC before it is
 * length-prefixed. Different devices/keyboards/platforms may produce
 * visually and semantically identical text as either precomposed (NFC) or
 * decomposed (NFD) codepoint sequences -- without normalization those
 * would canonicalize to different byte strings for what is the same
 * signed content, breaking cross-device signature/hash verification.
 * Machine identifiers, enum values, and opaque IDs (messageId, policyId,
 * familyScopeRef, category, language tag, childProfileIds, suggestionId,
 * dates, timezoneId) are NOT user-authored Unicode text under this
 * contract and are canonicalized as-is -- normalizing them would risk
 * changing their defined identity semantics.
 */

import type {
  CustomWellbeingMessage,
  CuratedSuggestionSelection,
  ScheduleWindow,
  TargetScope,
  WellbeingMessageControlV1,
} from './types.js';

function field(value: string): string {
  return `${Buffer.byteLength(value, 'utf8')}:${value}`;
}

/** Normalizes user-authored free text to Unicode NFC before it enters the canonical form. */
function userTextField(value: string): string {
  return field(value.normalize('NFC'));
}

function canonicalizeTargetScope(target: TargetScope): string {
  const ids = [...target.childProfileIds].sort();
  return [field(target.mode), field(String(ids.length)), ...ids.map(field)].join('');
}

function canonicalizeSchedule(schedule: ScheduleWindow): string {
  const days = [...schedule.daysOfWeek].sort();
  const windows = [...schedule.timeWindows].sort((a, b) => a.startMinute - b.startMinute || a.endMinute - b.endMinute);
  return [
    field(schedule.startDate !== undefined ? '1' : '0'),
    field(schedule.startDate ?? ''),
    field(schedule.endDate !== undefined ? '1' : '0'),
    field(schedule.endDate ?? ''),
    field(String(days.length)),
    ...days.map(field),
    field(String(windows.length)),
    ...windows.flatMap((w) => [field(String(w.startMinute)), field(String(w.endMinute))]),
    field(schedule.timezoneId !== undefined ? '1' : '0'),
    field(schedule.timezoneId ?? ''),
  ].join('');
}

function canonicalizeCustomMessage(message: CustomWellbeingMessage): string {
  const languageTags = Object.keys(message.languageTexts).sort();
  const triggers = [...message.delivery.triggers].sort();
  return [
    field(message.messageId),
    field(message.enabled ? '1' : '0'),
    field(message.category),
    field(String(languageTags.length)),
    ...languageTags.flatMap((tag) => [
      field(tag),
      userTextField(message.languageTexts[tag].title),
      userTextField(message.languageTexts[tag].body),
    ]),
    canonicalizeSchedule(message.schedule),
    field(String(triggers.length)),
    ...triggers.map(field),
    field(String(message.delivery.minimumIntervalMinutes)),
    field(String(message.delivery.maximumPerDay)),
    field(String(message.delivery.repeatCooldownMinutes)),
    field(message.delivery.lockScreenAllowed ? '1' : '0'),
    field(message.delivery.dismissible ? '1' : '0'),
    field(message.delivery.snoozable ? '1' : '0'),
    field(message.delivery.requiresAdultSupervision ? '1' : '0'),
    canonicalizeTargetScope(message.target),
    field(message.archivedAt !== undefined ? '1' : '0'),
    field(message.archivedAt ?? ''),
  ].join('');
}

function canonicalizeCuratedSelection(selection: CuratedSuggestionSelection): string {
  return [field(selection.suggestionId), field(selection.enabled ? '1' : '0')].join('');
}

export function canonicalizePolicy(policy: WellbeingMessageControlV1): string {
  const curated = [...policy.selectedCuratedSuggestionIds].sort((a, b) => a.suggestionId.localeCompare(b.suggestionId));
  const messages = [...policy.customMessages].sort((a, b) => a.messageId.localeCompare(b.messageId));
  return [
    field(String(policy.version)),
    field(policy.policyId),
    field(String(policy.policyRevision)),
    field(policy.familyScopeRef),
    canonicalizeTargetScope(policy.targets),
    field(policy.enabled ? '1' : '0'),
    field(String(curated.length)),
    ...curated.map(canonicalizeCuratedSelection),
    field(String(messages.length)),
    ...messages.map(canonicalizeCustomMessage),
    field(policy.createdAt),
    field(policy.updatedAt),
  ].join('');
}
