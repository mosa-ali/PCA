import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryWebRuleRepository, WebRuleError, WebRuleService } from '../../dist/web/WebRuleStore.js';

test('setParentRule stores a canonical, family-scoped allow rule', async () => {
  const service = new WebRuleService(new InMemoryWebRuleRepository(), () => new Date('2026-01-01T00:00:00Z'));
  const rule = await service.setParentRule('fam-1', 'Example.com', 'ALLOW', 'PARENT_ALLOWLIST');
  assert.equal(rule.domain, 'example.com');
  assert.equal(rule.source, 'PARENT_ALLOWLIST');
});

test('setParentRule rejects a non-canonicalizable domain', async () => {
  const service = new WebRuleService(new InMemoryWebRuleRepository());
  await assert.rejects(() => service.setParentRule('fam-1', '192.168.1.1', 'DENY', 'PARENT_DENYLIST'), WebRuleError);
});

test('setParentRule rejects SECURITY_DENYLIST writes through the family-scoped API', async () => {
  const service = new WebRuleService(new InMemoryWebRuleRepository());
  await assert.rejects(
    () => service.setParentRule('fam-1', 'example.com', 'DENY', 'SECURITY_DENYLIST'),
    (err) => err instanceof WebRuleError && err.code === 'FORBIDDEN_SOURCE',
  );
});

test('setParentRule rejects a source/listType mismatch', async () => {
  const service = new WebRuleService(new InMemoryWebRuleRepository());
  await assert.rejects(
    () => service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_ALLOWLIST'),
    (err) => err instanceof WebRuleError && err.code === 'SOURCE_LIST_MISMATCH',
  );
});

test('findMatching returns both family-scoped and global security rules, never another family\'s rules', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);
  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  await service.setParentRule('fam-2', 'example.com', 'ALLOW', 'PARENT_ALLOWLIST');
  await repo.put({ domain: 'example.com', listType: 'DENY', source: 'SECURITY_DENYLIST', familyId: null, createdAt: new Date() });

  const matched = await repo.findMatching('fam-1', 'example.com');
  const sources = matched.map((r) => r.source).sort();
  assert.deepEqual(sources, ['PARENT_DENYLIST', 'SECURITY_DENYLIST']);
});

test('removeParentRule deletes a previously stored rule', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);
  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  await service.removeParentRule('fam-1', 'example.com', 'DENY');
  const matched = await repo.findMatching('fam-1', 'example.com');
  assert.equal(matched.length, 0);
});
