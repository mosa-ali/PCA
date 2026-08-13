import { describe, expect, it } from 'vitest';
import { validateWebRuleDomain } from '../../src/domain/webRulePolicy';
import type { WebRuleEntry } from '../../src/domain/webRulePolicy';

describe('validateWebRuleDomain', () => {
  it('accepts a valid, not-yet-listed domain', () => {
    const result = validateWebRuleDomain('example.com', 'DENY', []);
    expect(result.valid).toBe(true);
    expect(result.canonicalDomain).toBe('example.com');
    expect(result.errors).toEqual([]);
  });

  it('canonicalizes before validating -- a full URL is accepted and normalized', () => {
    const result = validateWebRuleDomain('https://Example.COM/path', 'DENY', []);
    expect(result.valid).toBe(true);
    expect(result.canonicalDomain).toBe('example.com');
  });

  it('rejects an empty domain', () => {
    const result = validateWebRuleDomain('   ', 'DENY', []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('DOMAIN_EMPTY');
  });

  it('rejects a malformed domain', () => {
    const result = validateWebRuleDomain('not a domain', 'DENY', []);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('DOMAIN_INVALID');
  });

  it('rejects a domain already present on the opposite list -- never silently contradictory', () => {
    const existing: WebRuleEntry[] = [{ domain: 'example.com', listType: 'ALLOW', createdAtUtc: new Date(0).toISOString() }];
    const result = validateWebRuleDomain('example.com', 'DENY', existing);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('DOMAIN_ALREADY_ON_OPPOSITE_LIST');
  });

  it('allows re-adding a domain already on the SAME list (idempotent update)', () => {
    const existing: WebRuleEntry[] = [{ domain: 'example.com', listType: 'DENY', createdAtUtc: new Date(0).toISOString() }];
    const result = validateWebRuleDomain('example.com', 'DENY', existing);
    expect(result.valid).toBe(true);
  });
});
