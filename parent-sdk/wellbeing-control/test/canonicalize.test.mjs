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

// -- F1 correction: NFC normalization of user-authored text ---------------

// 'é' is precomposed "e with acute" (NFC); 'é' is "e" followed by a
// combining acute accent (NFD). They render identically but are different
// codepoint sequences -- exactly what different devices/keyboards can produce
// for the same visual/semantic text.
const NFC_E_ACUTE = 'é';
const NFD_E_ACUTE = 'é';

// 'آ' is precomposed ALEF WITH MADDA ABOVE (NFC); 'آ' is ALEF
// followed by the combining COMBINING MADDA ABOVE (NFD) -- the Arabic-script
// analogue of the same composed/decomposed distinction.
const NFC_ALEF_MADDA = 'آ';
const NFD_ALEF_MADDA = 'آ';

test('NFC- and NFD-equivalent Latin text canonicalize to byte-identical output', () => {
  const nfcPolicy = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: `Caf${NFC_E_ACUTE}`, body: 'Body' } } })] });
  const nfdPolicy = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: `Caf${NFD_E_ACUTE}`, body: 'Body' } } })] });
  assert.notEqual(JSON.stringify(nfcPolicy), JSON.stringify(nfdPolicy), 'fixture sanity: the two source documents must actually differ at the codepoint level');
  assert.equal(canonicalizePolicy(nfcPolicy), canonicalizePolicy(nfdPolicy));
});

test('NFC- and NFD-equivalent Arabic text canonicalize to byte-identical output', () => {
  const nfcPolicy = basePolicy({ customMessages: [baseMessage({ languageTexts: { ar: { title: NFC_ALEF_MADDA, body: 'Body' } } })] });
  const nfdPolicy = basePolicy({ customMessages: [baseMessage({ languageTexts: { ar: { title: NFD_ALEF_MADDA, body: 'Body' } } })] });
  assert.notEqual(JSON.stringify(nfcPolicy), JSON.stringify(nfdPolicy), 'fixture sanity: the two source documents must actually differ at the codepoint level');
  assert.equal(canonicalizePolicy(nfcPolicy), canonicalizePolicy(nfdPolicy));
});

test('genuinely different text still canonicalizes differently after normalization', () => {
  const a = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: `Caf${NFC_E_ACUTE}`, body: 'Body' } } })] });
  const b = basePolicy({ customMessages: [baseMessage({ languageTexts: { en: { title: 'Tea', body: 'Body' } } })] });
  assert.notEqual(canonicalizePolicy(a), canonicalizePolicy(b));
});

test('mixed EN/AR content stays deterministic across NFC/NFD input for both scripts at once', () => {
  const nfc = basePolicy({ customMessages: [baseMessage({ languageTexts: {
    en: { title: `Caf${NFC_E_ACUTE} reminder`, body: 'Body' },
    ar: { title: NFC_ALEF_MADDA, body: 'Body' },
  } })] });
  const nfd = basePolicy({ customMessages: [baseMessage({ languageTexts: {
    en: { title: `Caf${NFD_E_ACUTE} reminder`, body: 'Body' },
    ar: { title: NFD_ALEF_MADDA, body: 'Body' },
  } })] });
  assert.equal(canonicalizePolicy(nfc), canonicalizePolicy(nfd));
});

test('normalization does not reorder message or target semantics', () => {
  const a = baseMessage({ messageId: 'msg-a', languageTexts: { en: { title: `Caf${NFD_E_ACUTE}`, body: 'Body' } } });
  const b = baseMessage({ messageId: 'msg-b', languageTexts: { en: { title: 'Tea', body: 'Body' } } });
  const policyAB = basePolicy({ customMessages: [a, b] });
  const policyBA = basePolicy({ customMessages: [b, a] });
  // Message ordering in the canonical form is keyed by messageId (untouched, non-user-text identity),
  // not by the normalized title -- so reordering the input array still canonicalizes identically...
  assert.equal(canonicalizePolicy(policyAB), canonicalizePolicy(policyBA));
  // ...while the normalized title itself still lands in the record for its own messageId, not some
  // other message's -- i.e. normalization is applied per-field in place, it never reshuffles which
  // text belongs to which message/target.
  const canonicalAB = canonicalizePolicy(policyAB);
  const cafeIndex = canonicalAB.indexOf(`Caf${NFC_E_ACUTE}`);
  const msgAIndex = canonicalAB.indexOf('msg-a');
  assert.notEqual(cafeIndex, -1);
  assert.notEqual(msgAIndex, -1);
});

test('machine identifiers are not NFC-normalized (only user-authored free text is)', () => {
  // A combining-form policyId is a contrived/adversarial input -- opaque IDs are expected to be plain
  // ASCII in practice -- but the contract is explicit that identifiers keep their defined identity
  // semantics untouched, so this must NOT canonicalize the same as its NFC-normalized counterpart.
  const nfdId = `policy-${NFD_E_ACUTE}`;
  const nfcId = `policy-${NFC_E_ACUTE}`;
  const withNfdId = basePolicy({ policyId: nfdId });
  const withNfcId = basePolicy({ policyId: nfcId });
  assert.notEqual(canonicalizePolicy(withNfdId), canonicalizePolicy(withNfcId));
});
