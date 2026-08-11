import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeDomain, hasSuspiciousScriptMixing, isCanonicalDomain } from '../../dist/web/canonicalize.js';

test('canonicalizeDomain lowercases and strips scheme/path/port/trailing dot', () => {
  assert.equal(canonicalizeDomain('Example.COM.'), 'example.com');
  assert.equal(canonicalizeDomain('https://Example.com:443/path?x=1'), 'example.com');
  assert.equal(canonicalizeDomain('  example.com  '), 'example.com');
  assert.equal(canonicalizeDomain('//example.com/path'), 'example.com');
  assert.equal(canonicalizeDomain('user:pass@example.com'), 'example.com');
});

test('canonicalizeDomain keeps www distinct from bare domain', () => {
  assert.equal(canonicalizeDomain('www.example.com'), 'www.example.com');
  assert.equal(canonicalizeDomain('example.com'), 'example.com');
});

test('canonicalizeDomain rejects IP literals, non-strings and malformed input', () => {
  assert.equal(canonicalizeDomain('192.168.1.1'), null);
  assert.equal(canonicalizeDomain('[::1]'), null);
  assert.equal(canonicalizeDomain('localhost'), null);
  assert.equal(canonicalizeDomain(''), null);
  assert.equal(canonicalizeDomain(null), null);
  assert.equal(canonicalizeDomain(123), null);
  assert.equal(canonicalizeDomain('-bad-.com'), null);
  assert.equal(canonicalizeDomain('a'.repeat(64) + '.com'), null);
});

test('isCanonicalDomain requires the value to already be in canonical form', () => {
  assert.equal(isCanonicalDomain('example.com'), true);
  assert.equal(isCanonicalDomain('Example.com'), false);
  assert.equal(isCanonicalDomain('https://example.com'), false);
});

// FINDING-005: Unicode IDN input and its A-label (punycode) equivalent must
// canonicalize to the identical CanonicalDomain string, so a rule authored
// against one representation matches a navigation attempt in the other.
test('a Unicode IDN and its xn-- A-label equivalent canonicalize identically', () => {
  const fromUnicode = canonicalizeDomain('münchen.example');
  const fromAlabel = canonicalizeDomain('xn--mnchen-3ya.example');
  assert.equal(fromUnicode, 'xn--mnchen-3ya.example');
  assert.equal(fromAlabel, 'xn--mnchen-3ya.example');
  assert.equal(fromUnicode, fromAlabel);
});

test('a Unicode IDN reached via a full URL canonicalizes the same as its bare hostname', () => {
  assert.equal(canonicalizeDomain('https://münchen.example/path?x=1'), 'xn--mnchen-3ya.example');
});

test('a mixed-case A-label canonicalizes the same as its lowercase form', () => {
  assert.equal(canonicalizeDomain('XN--MNCHEN-3YA.EXAMPLE'), 'xn--mnchen-3ya.example');
  assert.equal(canonicalizeDomain('Xn--Mnchen-3ya.example'), 'xn--mnchen-3ya.example');
});

test('malformed punycode fails safely (null), never passed through unconverted', () => {
  assert.equal(canonicalizeDomain('xn--zzzzzz.example'), null);
  assert.equal(canonicalizeDomain('xn-- --.example'), null);
});

test('IDN canonicalization applies per-label within a subdomain', () => {
  const fromUnicode = canonicalizeDomain('mail.münchen.example');
  const fromAlabel = canonicalizeDomain('mail.xn--mnchen-3ya.example');
  assert.equal(fromUnicode, 'mail.xn--mnchen-3ya.example');
  assert.equal(fromUnicode, fromAlabel);
});

test('allowlist/denylist keying is unaffected by which representation produced the rule domain', () => {
  // Both representations must be usable interchangeably as the SAME rule key.
  const key1 = canonicalizeDomain('пример.example'); // Cyrillic "example"
  const key2 = canonicalizeDomain(canonicalizeDomain('пример.example'));
  assert.equal(key1, key2); // idempotent: canonical output re-canonicalizes to itself
  assert.equal(isCanonicalDomain(key1), true);
});

test('hasSuspiciousScriptMixing flags a known homograph-shaped input (Cyrillic а + Latin pple)', () => {
  assert.equal(hasSuspiciousScriptMixing('аpple.example'), true); // U+0430 CYRILLIC SMALL LETTER A
  assert.equal(hasSuspiciousScriptMixing(canonicalizeDomain('аpple.example')), true); // same signal from the A-label form
});

test('hasSuspiciousScriptMixing does not flag a genuinely single-script IDN label', () => {
  assert.equal(hasSuspiciousScriptMixing('münchen.example'), false);
  assert.equal(hasSuspiciousScriptMixing('пример.example'), false); // all-Cyrillic label
  assert.equal(hasSuspiciousScriptMixing('example.com'), false);
});

test('hasSuspiciousScriptMixing never changes the CanonicalDomain canonicalizeDomain returns', () => {
  const domain = canonicalizeDomain('аpple.example');
  hasSuspiciousScriptMixing('аpple.example');
  assert.equal(canonicalizeDomain('аpple.example'), domain); // still deterministic/unaffected
});
