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

// NEW-003 regression: InMemoryWebRuleRepository's internal Map key is built
// from `${familyId} ${domain} ${listType}`. put() and remove() must key an
// identical (familyId, domain, listType) triple to the SAME Map entry
// (round-trip: put then remove then find returns nothing) while distinct
// triples -- including ones that share a domain or a listType -- must never
// collide with one another. This is unaffected by which separator
// character sits between the fields, since opaque family ids and
// canonicalized domains never contain that character; the assertions below
// only depend on put/remove/findMatching agreeing on the same key, not on
// the exact byte used to join them.
test('rule keys round-trip through put/remove and never collide across distinct families, domains or list types', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);

  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  await service.setParentRule('fam-1', 'example.com', 'ALLOW', 'PARENT_ALLOWLIST');
  await service.setParentRule('fam-1', 'other.example', 'DENY', 'PARENT_DENYLIST');
  await service.setParentRule('fam-2', 'example.com', 'DENY', 'PARENT_DENYLIST');

  const famOneExampleCom = await repo.findMatching('fam-1', 'example.com');
  assert.equal(famOneExampleCom.length, 2); // DENY and ALLOW coexist as distinct keys, not overwritten
  assert.deepEqual(famOneExampleCom.map((r) => r.listType).sort(), ['ALLOW', 'DENY']);

  const famOneOtherExample = await repo.findMatching('fam-1', 'other.example');
  assert.equal(famOneOtherExample.length, 1);

  const famTwoExampleCom = await repo.findMatching('fam-2', 'example.com');
  assert.equal(famTwoExampleCom.length, 1);

  // Removing one (familyId, domain, listType) triple must not disturb any other.
  await service.removeParentRule('fam-1', 'example.com', 'DENY');
  const afterRemoval = await repo.findMatching('fam-1', 'example.com');
  assert.equal(afterRemoval.length, 1);
  assert.equal(afterRemoval[0].listType, 'ALLOW');
  assert.equal((await repo.findMatching('fam-1', 'other.example')).length, 1);
  assert.equal((await repo.findMatching('fam-2', 'example.com')).length, 1);
});

// WEB_RULE mutation shape/serialization end-to-end: listParentRules backs
// the parent-facing rule LIST returned by the new webRuleRoutes.ts mutation
// routes (GET/POST/POST-remove), never the per-domain decision pipeline
// (findMatching stays the sole source for that).
test('listParentRules returns every parent-authored rule for the family, across domains', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);
  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  await service.setParentRule('fam-1', 'other.example', 'ALLOW', 'PARENT_ALLOWLIST');
  await service.setParentRule('fam-2', 'third.example', 'DENY', 'PARENT_DENYLIST');

  const rules = await service.listParentRules('fam-1');
  const domains = rules.map((r) => r.domain).sort();
  assert.deepEqual(domains, ['example.com', 'other.example']);
});

test('listParentRules never exposes the global SECURITY_DENYLIST feed through the family-scoped API', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);
  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  // A security-feed rule is never family-scoped (familyId: null), so listByFamily('fam-1')
  // would never surface it regardless -- this asserts listParentRules' own
  // FAMILY_WRITABLE_SOURCES filter is real, not merely relying on that fact.
  await repo.put({ domain: 'malware.example', listType: 'DENY', source: 'SECURITY_DENYLIST', familyId: 'fam-1', createdAt: new Date() });

  const rules = await service.listParentRules('fam-1');
  assert.deepEqual(rules.map((r) => r.domain).sort(), ['example.com']);
});

test('listParentRules reflects a removal', async () => {
  const repo = new InMemoryWebRuleRepository();
  const service = new WebRuleService(repo);
  await service.setParentRule('fam-1', 'example.com', 'DENY', 'PARENT_DENYLIST');
  await service.removeParentRule('fam-1', 'example.com', 'DENY');
  assert.deepEqual(await service.listParentRules('fam-1'), []);
});
