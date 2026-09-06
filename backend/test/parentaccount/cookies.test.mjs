// PCA-DW-W2-15C -- cookie name/Secure-attribute environment sensitivity.
// sessionCookieName() must agree with serializeCookie's Secure attribute
// and with parseCookies on every read, for BOTH the safe (test/
// development) and production-sensitive case -- a read/write name mismatch
// here is a silent "every session breaks" bug, not a cosmetic one.
// csrfCookieName() deliberately never changes -- see its own doc comment
// in cookies.ts for why (parent-web's frontend reads it by a hardcoded
// literal name in ~15 files).
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  csrfCookieName,
  parseCookies,
  serializeCookie,
  serializeExpiredCookie,
  sessionCookieName,
} from '../../dist/parentaccount/cookies.js';

test('sessionCookieName is the bare (unprefixed) name under test/development', () => {
  assert.equal(sessionCookieName({ NODE_ENV: 'test' }), 'pca_family_session');
  assert.equal(sessionCookieName({ NODE_ENV: 'development' }), 'pca_family_session');
});

test('SECURITY: sessionCookieName adopts the __Host- prefix whenever Secure will be true -- production, and FAIL CLOSED for missing/unrecognized NODE_ENV', () => {
  assert.equal(sessionCookieName({ NODE_ENV: 'production' }), '__Host-pca_family_session');
  assert.equal(sessionCookieName({}), '__Host-pca_family_session', 'unset NODE_ENV must fail closed to the Secure/__Host- name, matching isProductionSensitiveRuntime');
});

test('csrfCookieName is NEVER prefixed, in any environment -- the CSRF cookie is read by a hardcoded literal name from ~15 parent-web frontend files, so prefixing it here without a coordinated frontend change would silently break CSRF on every authenticated mutation in production', () => {
  assert.equal(csrfCookieName({ NODE_ENV: 'test' }), 'pca_family_csrf');
  assert.equal(csrfCookieName({ NODE_ENV: 'development' }), 'pca_family_csrf');
  assert.equal(csrfCookieName({ NODE_ENV: 'production' }), 'pca_family_csrf');
  assert.equal(csrfCookieName({}), 'pca_family_csrf');
});

test('__Host- prefix preconditions: whenever the name is __Host--prefixed, serializeCookie(secure=true) actually emits Secure, Path=/, and no Domain attribute', () => {
  const name = sessionCookieName({ NODE_ENV: 'production' });
  const header = serializeCookie(name, 'token-value', { httpOnly: true, secure: true, maxAgeSeconds: 60 });
  assert.match(header, /^__Host-pca_family_session=/);
  assert.match(header, /Secure/i);
  assert.match(header, /Path=\//);
  assert.doesNotMatch(header, /Domain=/i);
});

test('round-trip: a cookie set under a given env is readable back via parseCookies using the SAME env -- read and write can never independently disagree on the name', () => {
  for (const env of [{ NODE_ENV: 'test' }, { NODE_ENV: 'production' }, {}]) {
    const name = sessionCookieName(env);
    const header = serializeCookie(name, 'abc123', { httpOnly: true, secure: true, maxAgeSeconds: 60 });
    const rawValue = header.split(';')[0];
    const parsed = parseCookies(rawValue);
    assert.equal(parsed.get(sessionCookieName(env)), 'abc123', `mismatch for env ${JSON.stringify(env)}`);
  }
});

test('serializeExpiredCookie clears whichever name is currently in force for a given env', () => {
  const name = sessionCookieName({ NODE_ENV: 'production' });
  const header = serializeExpiredCookie(name, { httpOnly: true, secure: true });
  assert.match(header, /^__Host-pca_family_session=;/);
  assert.match(header, /Max-Age=0/);
});
