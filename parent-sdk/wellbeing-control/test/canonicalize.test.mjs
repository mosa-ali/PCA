import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizePolicy } from '../dist/canonicalize.js';
import { basePolicy, baseMessage } from './fixtures.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('canonicalization is deterministic for an identical document', () => {
  const policy = basePolicy({ customMessages: [baseMessage()] });
  assert.equal(canonicalizePolicy(policy), canonicalizePolicy(clone(policy)));
});

test('canonicalization is stable under custom-message array reordering', () => {
  const a = baseMessage({ messageId: 'msg-a' });
  const b = baseMessage({ messageId: 'msg-b' });
  const policyAB = basePolicy({ customMessages: [a, b] });
  const policyBA = basePolicy({ customMessages: [b, a] });
  assert.equal(canonicalizePolicy(policyAB), canonicalizePolicy(policyBA));
});

test('canonicalization is stable under curated-selection array reordering', () => {
  const selections = [{ suggestionId: 'sug-a', enabled: true }, { suggestionId: 'sug-b', enabled: false }];
  const policyOrderA = basePolicy({ selectedCuratedSuggestionIds: selections });
  const policyOrderB = basePolicy({ selectedCuratedSuggestionIds: [...selections].reverse() });
  assert.equal(canonicalizePolicy(policyOrderA), canonicalizePolicy(policyOrderB));
});

test('canonicalization is stable under time-window and day-of-week reordering', () => {
  const scheduleA = { daysOfWeek: ['MON', 'FRI'], timeWindows: [{ startMinute: 60, endMinute: 120 }, { startMinute: 480, endMinute: 540 }] };
  const scheduleB = { daysOfWeek: ['FRI', 'MON'], timeWindows: [{ startMinute: 480, endMinute: 540 }, { startMinute: 60, endMinute: 120 }] };
  const policyA = basePolicy({ customMessages: [baseMessage({ schedule: scheduleA })] });
  const policyB = basePolicy({ customMessages: [baseMessage({ schedule: scheduleB })] });
  assert.equal(canonicalizePolicy(policyA), canonicalizePolicy(policyB));
});

test('a different policyRevision produces a different canonical form', () => {
  const a = basePolicy({ policyRevision: 1 });
  const b = basePolicy({ policyRevision: 2 });
  assert.notEqual(canonicalizePolicy(a), canonicalizePolicy(b));
});

test('a different custom message body produces a different canonical form', () => {
  const a = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: 'T', body: 'Body one' } } })] });
  const b = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: 'T', body: 'Body two' } } })] });
  assert.notEqual(canonicalizePolicy(a), canonicalizePolicy(b));
});

test('field boundaries cannot be crafted to collide (length-prefixing defeats concatenation ambiguity)', () => {
  const a = basePolicy({ policyId: 'ab', familyScopeRef: 'c' });
  const b = basePolicy({ policyId: 'a', familyScopeRef: 'bc' });
  assert.notEqual(canonicalizePolicy(a), canonicalizePolicy(b));
});

test('Arabic custom text canonicalizes deterministically and preserves the characters', () => {
  const message = baseMessage({ languageTexts: { ar: { title: 'قل شكرا', body: 'أخبر أحد أفراد عائلتك بالشكر اليوم.' } } });
  const policy = basePolicy({ customMessages: [message] });
  const canonical = canonicalizePolicy(policy);
  assert.equal(canonical, canonicalizePolicy(clone(policy)));
  assert.equal(canonical.includes('قل شكرا'), true);
});

test('mixed-direction (Arabic + Latin) text canonicalizes deterministically', () => {
  const message = baseMessage({ languageTexts: { ar: { title: 'Reminder قل شكرا', body: 'Body نص' } } });
  const policy = basePolicy({ customMessages: [message] });
  assert.equal(canonicalizePolicy(policy), canonicalizePolicy(clone(policy)));
});

test('duplicate messageId keys do not silently collapse -- both entries contribute to the canonical form', () => {
  const a = baseMessage({ messageId: 'dup', languageTexts: { en: { title: 'First', body: 'Body' } } });
  const b = baseMessage({ messageId: 'dup', languageTexts: { en: { title: 'Second', body: 'Body' } } });
  const policy = basePolicy({ customMessages: [a, b] });
  const canonical = canonicalizePolicy(policy);
  assert.equal(canonical.includes('First'), true);
  assert.equal(canonical.includes('Second'), true);
});
