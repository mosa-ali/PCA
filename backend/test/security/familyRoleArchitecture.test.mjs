import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const read = (relative) => readFile(new URL(relative, root), 'utf8');

test('family roles are stored in a family-scoped membership table, not parent_accounts', async () => {
  const migration = await read('migrations/0043_parent_family_memberships_and_profile.sql');
  // The optional guard is accepted deliberately: migration 0043 is not yet
  // applied in production, so it carries `CREATE TABLE IF NOT EXISTS` to stay
  // resumable after an interrupted apply (PCA finding P1-07). The assertion's
  // intent -- that family roles live in their OWN family-scoped table -- is
  // unchanged.
  assert.match(migration, /CREATE TABLE (IF NOT EXISTS )?family_parent_memberships/);
  assert.match(migration, /role VARCHAR\(16\) NOT NULL/);
  assert.match(migration, /CHECK \(role IN \('ADMINISTRATOR', 'VIEWER', 'CHILD'\)\)/);
  assert.doesNotMatch(migration, /ALTER TABLE parent_accounts[\s\S]*?ADD COLUMN\s+role\b/i);
});

test('session role is server-issued and frontend no longer assumes VIEWER or OWNER from familyId', async () => {
  const client = await read('../parent-web/src/api/real/realServiceAuthClient.ts');
  // The wire role is the closed server-issued family-role set (inline or via a named wire type).
  assert.match(client, /(role:|type WireRole =) 'ADMINISTRATOR' \| 'VIEWER' \| 'CHILD'/);
  assert.doesNotMatch(client, /toAuthenticatedSession\(body,\s*'VIEWER'\)/);
  assert.doesNotMatch(client, /body\.familyId \? 'OWNER' : 'VIEWER'/);
});

test('PCA-DEC-037: creator ADMINISTRATOR membership is written only by the one-transaction server-side family provisioning, never by email verification', async () => {
  const service = await read('src/parentaccount/ParentAccountService.ts');
  const repository = await read('src/parentaccount/MySqlParentAccountRepository.ts');
  assert.doesNotMatch(service, /createGenesisAdministrator/);

  // Email verification binds no family.
  const verifyEmail = service.slice(service.indexOf('async verifyEmail('), service.indexOf('async login('));
  assert.match(verifyEmail, /familyId: null,/);
  assert.doesNotMatch(verifyEmail, /ensureProvisionedFamily|issueSession/);

  // Provisioning is one runInTransaction that row-locks the account first.
  const start = repository.indexOf('async ensureProvisionedFamily(');
  assert.ok(start >= 0, 'MySqlParentAccountRepository must implement ensureProvisionedFamily');
  const provisioning = repository.slice(start, repository.indexOf('\n  }\n', start));
  assert.equal((provisioning.match(/runInTransaction\(/g) ?? []).length, 1, 'exactly one transaction');
  assert.match(provisioning, /return runInTransaction\(async \(conn\) =>/);
  assert.match(provisioning, /SELECT status, family_id, service_account_id, disabled_at FROM parent_accounts WHERE account_id = \? FOR UPDATE/);
  assert.ok(
    provisioning.indexOf('FOR UPDATE') < provisioning.indexOf('INSERT INTO families'),
    'the account row is locked before any family is created',
  );
  // Refuses anything but a verified, enabled account bound to this service account.
  assert.match(provisioning, /account\.status !== 'VERIFIED' \|\| account\.disabled_at !== null \|\| account\.service_account_id !== serviceAccountId/);
  // The family records WHICH account it was provisioned for (the uniqueness anchor).
  assert.match(provisioning, /INSERT INTO families \(family_id, family_reference_hash, created_at, provisioned_for_account_id\) VALUES \(\?, \?, \?, \?\)/);
  assert.match(provisioning, /UPDATE parent_accounts SET family_id = \? WHERE account_id = \? AND family_id IS NULL/);
  // ADMINISTRATOR membership + ACTIVE scope only for the family provisioned for THIS account.
  assert.match(provisioning, /if \(ownerRows\[0\]\?\.provisioned_for_account_id === accountId\)/);
  assert.match(provisioning, /INSERT INTO family_parent_memberships[\s\S]*?'ADMINISTRATOR', 'ACTIVE'/);
  assert.match(provisioning, /INSERT INTO service_account_family_scopes[\s\S]*?'ACTIVE'/);
  // A REVOKED membership is never revived by a later login.
  assert.doesNotMatch(provisioning, /ON DUPLICATE KEY UPDATE[^`]*status\s*=/);
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
