import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalizeDomain, isCanonicalDomain } from '../../dist/web/canonicalize.js';

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
