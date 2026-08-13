import { describe, expect, it } from 'vitest';
import { canonicalizeDomain, isCanonicalDomain } from '../../src/domain/webRuleCanonicalize';

// PCA-WEB-RUNTIME-1 (doc 25): these vectors mirror the structural rules in
// backend/src/web/canonicalize.ts and
// android/.../policy/WebDomainCanonicalizer.kt (see WebDomainCanonicalizerTest.kt)
// -- if this browser mirror ever disagrees with either of those on one of
// these cases, this suite is the tripwire.
describe('canonicalizeDomain -- browser-native mirror of backend canonicalize.ts', () => {
  it.each([
    ['bare lowercase domain', 'example.com', 'example.com'],
    ['uppercase is lowercased', 'Example.COM', 'example.com'],
    ['trailing dot is stripped', 'example.com.', 'example.com'],
    ['full https URL reduces to hostname', 'https://example.com/path?x=1', 'example.com'],
    ['full http URL reduces to hostname', 'http://example.com/', 'example.com'],
    ['port is stripped', 'example.com:8443', 'example.com'],
    ['embedded credentials are discarded, never trusted', 'user:pass@example.com', 'example.com'],
    ['subdomain is preserved, never merged with the parent', 'www.example.com', 'www.example.com'],
    ['whitespace is trimmed', '  example.com  ', 'example.com'],
  ])('%s', (_label, input, expected) => {
    expect(canonicalizeDomain(input)).toBe(expected);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['bare single-label host', 'localhost'],
    ['IPv4 literal', '192.168.0.1'],
    ['IPv6 literal in brackets', '[::1]'],
    ['not a string', 123],
    ['null', null],
    ['undefined', undefined],
  ])('rejects %s', (_label, input) => {
    expect(canonicalizeDomain(input)).toBeNull();
  });

  it('isCanonicalDomain is true only for an already-canonical string', () => {
    expect(isCanonicalDomain('example.com')).toBe(true);
    expect(isCanonicalDomain('Example.COM')).toBe(false);
    expect(isCanonicalDomain('not a domain')).toBe(false);
  });
});
