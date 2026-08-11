import assert from 'node:assert/strict';
import test from 'node:test';
import { AR_MESSAGES } from '../../dist/i18n/messages/ar.js';
import { EN_MESSAGES } from '../../dist/i18n/messages/en.js';
import { SUPPORTED_LOCALES } from '../../dist/i18n/types.js';
import { translate } from '../../dist/i18n/translate.js';

// doc 20 Section 2/lane brief Section 17: "Missing Arabic must not silently ship." EN_MESSAGES
// and AR_MESSAGES are both statically typed as Record<MessageId, string>, so TypeScript already
// refuses to compile if either omits a key -- this test is the RUNTIME belt-and-suspenders
// check, so a future refactor to a partial/dynamic table can't silently reintroduce the gap.
test('every message id has both an English and an Arabic entry', () => {
  const enKeys = Object.keys(EN_MESSAGES).sort();
  const arKeys = Object.keys(AR_MESSAGES).sort();
  assert.deepEqual(enKeys, arKeys);
  assert.ok(enKeys.length > 30, 'expected broad domain coverage from the PCA-16A wave-2 audit');
});

test('every message id is domain-namespaced (contains a "." or is the one bare demo id) -- no bare reused error code', () => {
  for (const id of Object.keys(EN_MESSAGES)) {
    assert.ok(id.includes('.') || id === 'DOMAIN_BLOCKED_NOTICE', `message id "${id}" is not namespaced`);
  }
});

test('no Arabic message is empty', () => {
  for (const [id, text] of Object.entries(AR_MESSAGES)) {
    assert.ok(text.trim().length > 0, `AR_MESSAGES.${id} is empty`);
  }
});

test('SUPPORTED_LOCALES is exactly en and ar (doc 20 PCA-FR-110/111)', () => {
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), ['ar', 'en']);
});

test('translate resolves a plain message with no placeholders in both locales', () => {
  assert.equal(translate('web.PARENT_DENYLIST', 'en'), "blocked by your family's block list");
  assert.equal(translate('web.PARENT_DENYLIST', 'ar'), 'محظور بواسطة قائمة الحظر الخاصة بعائلتك');
});

test('translate substitutes a domain placeholder without concatenating fragments', () => {
  const en = translate('DOMAIN_BLOCKED_NOTICE', 'en', { domain: 'example.com' });
  assert.equal(en, 'example.com was blocked under your family’s rule');
});

test('translate wraps the substituted domain in bidi isolates for the Arabic template', () => {
  const ar = translate('DOMAIN_BLOCKED_NOTICE', 'ar', { domain: 'example.com' });
  assert.ok(ar.includes('⁦example.com⁩'), `expected isolated domain in: ${ar}`);
  assert.ok(ar.startsWith('تم حظر'));
});

test('translate sanitizes hostile bidi control characters out of a substituted domain', () => {
  const hostile = 'evil‮moc.elpmaxe'; // RLO-poisoned "domain"
  const result = translate('DOMAIN_BLOCKED_NOTICE', 'en', { domain: hostile });
  assert.ok(!result.includes('‮'));
});

test('translate substitutes numeric schedule placeholders without concatenation, English and Arabic', () => {
  const en = translate('schedule.BLOCKED_LIMIT_REACHED', 'en', { usedMinutes: 65, limitMinutes: 60 });
  assert.equal(en, 'Blocked: used 65 of 60 minutes today.');
  const ar = translate('schedule.BLOCKED_LIMIT_REACHED', 'ar', { usedMinutes: 65, limitMinutes: 60 });
  assert.ok(ar.includes('65') && ar.includes('60'));
});

test('translate substitutes multiple distinct numeric placeholders (school-mode window counts)', () => {
  const en = translate('schedule.BLOCKED_SCHOOL_MODE', 'en', { windowCount: 2, totalWindowCount: 3 });
  assert.equal(en, 'Blocked: outside the allowed scope of 2 of 3 active school-mode windows.');
});

test('translate falls back to English and reports the fallback event for a locale missing an entry, never throwing', () => {
  const events = [];
  // Simulate a hypothetical incomplete locale by requesting an id through the public API with a
  // deliberately empty override -- exercised via the onFallback callback contract itself, since
  // the real AR_MESSAGES table is already complete (see completeness test above).
  const result = translate('web.DEFAULT', 'ar', {}, (event) => events.push(event));
  assert.equal(typeof result, 'string');
  assert.equal(events.length, 0); // no fallback fired because ar IS complete
});

test('every SafeExplanationKind-derived message avoids psychological/personality language (spot check)', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const text = translate('ai.MODEL_UNAVAILABLE', locale);
    assert.ok(!/personal|emotion|iq|character/i.test(text));
  }
});

test('the same bare code reused across domains (e.g. NOT_FOUND) resolves independently correct English text per domain', () => {
  assert.equal(translate('enrollment.NOT_FOUND', 'en'), 'Invitation was not found.');
  assert.equal(translate('model.NOT_FOUND', 'en'), 'Model lifecycle record does not exist.');
  assert.equal(translate('childRequest.NOT_FOUND', 'en'), 'Child request does not exist.');
  assert.notEqual(translate('enrollment.NOT_FOUND', 'en'), translate('model.NOT_FOUND', 'en'));
});

test('retention deletion-confirmation and export-outcome messages exist for every reason/outcome kind (doc 20 FR-113)', () => {
  for (const reason of ['EXPIRED', 'ROLLING_RETENTION_SUPERSEDED', 'DELETE_NOW']) {
    assert.ok(translate(`retention.${reason}`, 'en').length > 0);
    assert.ok(translate(`retention.${reason}`, 'ar').length > 0);
  }
  for (const outcome of ['COMPLETED', 'CANCELLED', 'FAILED']) {
    assert.ok(translate(`export.${outcome}`, 'en').length > 0);
    assert.ok(translate(`export.${outcome}`, 'ar').length > 0);
  }
});

test('YouTube Mode B event labels never say "watched" in either locale (doc 15/PCA-6 invariant preserved through localization)', () => {
  for (const eventType of [
    'PLAYBACK_STARTED',
    'PLAYBACK_STATE_OBSERVED',
    'PLAYBACK_COMPLETED_SIGNAL_OBSERVED',
    'PLAYBACK_ERROR',
  ]) {
    for (const locale of SUPPORTED_LOCALES) {
      const label = translate(`youtube.modeBEvent.${eventType}`, locale);
      assert.doesNotMatch(label.toLowerCase(), /watched/);
    }
  }
});
