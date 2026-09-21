import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

test('family roles are stored in a family-scoped membership table, not parent_accounts', async () => {
  const migration = await read('migrations/0043_parent_family_memberships_and_profile.sql');
  assert.match(migration, /CREATE TABLE family_parent_memberships/);
  assert.match(migration, /role VARCHAR\(16\) NOT NULL/);
  assert.match(migration, /CHECK \(role IN \('ADMINISTRATOR', 'VIEWER', 'CHILD'\)\)/);
  assert.doesNotMatch(migration, /ALTER TABLE parent_accounts[\s\S]*?ADD COLUMN\s+role\b/i);
});

test('session role is server-issued and frontend no longer assumes VIEWER or OWNER from familyId', async () => {
  const client = await read('../parent-web/src/api/real/realServiceAuthClient.ts');
  assert.match(client, /role: 'ADMINISTRATOR' \| 'VIEWER' \| 'CHILD'/);
  assert.doesNotMatch(client, /toAuthenticatedSession\(body,\s*'VIEWER'\)/);
  assert.doesNotMatch(client, /body\.familyId \? 'OWNER' : 'VIEWER'/);
});

test('creator membership is unreachable until the separate secure genesis transaction succeeds', async () => {
  const service = await read('src/parentaccount/ParentAccountService.ts');
  const genesis = await read('src/parentaccount/ParentGenesisService.ts');
  assert.doesNotMatch(service, /createGenesisAdministrator/);
  assert.match(service, /const familyId: OpaqueFamilyId \| null = null/);
  assert.match(genesis, /transactionRepository\.completeAtomically/);
  assert.match(genesis, /familyId: challenge\.familyId/);
});

test('signup profile fields are bounded metadata and cannot influence family role resolution', async () => {
  const migration = await read('migrations/0043_parent_family_memberships_and_profile.sql');
  const service = await read('src/parentaccount/ParentAccountService.ts');
  assert.match(migration, /account_type VARCHAR\(24\)/);
  assert.match(migration, /estimated_child_count INT UNSIGNED/);
  assert.match(migration, /estimated_child_count <= 50/);
  const resolver = service.slice(service.indexOf('private async resolveFamilyRole'));
  assert.doesNotMatch(resolver, /accountType|estimatedChildCount/);
});

test('platform and family role sets remain separate', async () => {
  const platform = await read('src/platformadmin/auth/types.ts');
  const family = await read('src/familymembers/FamilyMembershipRepository.ts');
  assert.match(platform, /APP_OWNER/);
  assert.match(platform, /PLATFORM_ADMIN/);
  assert.match(family, /FamilyMembershipRole = 'ADMINISTRATOR' \| 'VIEWER' \| 'CHILD'/);
  assert.doesNotMatch(family, /APP_OWNER|PLATFORM_ADMIN|FINANCE_ADMIN|SUPPORT_ADMIN/);
});

test('prepared production remediation is bounded to the two owner-specified email hashes and cannot fabricate a family', async () => {
  const sql = await read('../docs/implementation/decisions/PCA_FAMILY_ROLE_REMEDIATION_SQL.md');
  assert.equal((sql.match(/mosamali2050@gmail\.com/g) ?? []).length >= 2, true);
  assert.equal((sql.match(/drwishm38@gmail\.com/g) ?? []).length >= 2, true);
  assert.match(sql, /pa\.family_id IS NOT NULL/);
  assert.doesNotMatch(sql, /INSERT INTO families|INSERT INTO service_account_family_scopes|family_authority_genesis_anchors\s*\(/i);
});
