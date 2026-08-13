import { describe, expect, it } from 'vitest';
import { DevWebRuleAdminClient } from '../../src/api/dev/devWebRuleAdminClient';

describe('DevWebRuleAdminClient', () => {
  it('starts with an empty LOCAL_DRAFT list for an unknown child', async () => {
    const client = new DevWebRuleAdminClient();
    const result = await client.listRules('child-1');
    expect(result.rules).toEqual([]);
    expect(result.status).toBe('LOCAL_DRAFT');
    expect(result.revision).toBeNull();
  });

  it('setRule adds a canonicalized entry and reports DELIVERED, never APPLIED', async () => {
    const client = new DevWebRuleAdminClient();
    const result = await client.setRule('child-1', 'Example.COM', 'DENY');
    expect(result.status).toBe('DELIVERED');
    expect(result.rules).toEqual([{ domain: 'example.com', listType: 'DENY', createdAtUtc: expect.any(String) }]);
  });

  it('setRule for the same domain/listType replaces rather than duplicates', async () => {
    const client = new DevWebRuleAdminClient();
    await client.setRule('child-1', 'example.com', 'DENY');
    const result = await client.setRule('child-1', 'example.com', 'DENY');
    expect(result.rules).toHaveLength(1);
  });

  it('setRule rejects an invalid domain without mutating state', async () => {
    const client = new DevWebRuleAdminClient();
    await expect(client.setRule('child-1', 'not a domain', 'DENY')).rejects.toThrow();
    const after = await client.listRules('child-1');
    expect(after.rules).toEqual([]);
  });

  it('removeRule removes exactly the matching domain/listType pair', async () => {
    const client = new DevWebRuleAdminClient();
    await client.setRule('child-1', 'example.com', 'DENY');
    await client.setRule('child-1', 'other.example', 'ALLOW');
    const result = await client.removeRule('child-1', 'example.com', 'DENY');
    expect(result.rules).toEqual([{ domain: 'other.example', listType: 'ALLOW', createdAtUtc: expect.any(String) }]);
  });

  it('rule state for different children never leaks across each other', async () => {
    const client = new DevWebRuleAdminClient();
    await client.setRule('child-1', 'example.com', 'DENY');
    const otherChild = await client.listRules('child-2');
    expect(otherChild.rules).toEqual([]);
  });
});
