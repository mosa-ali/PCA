// PCA-PA-1 owner architecture decision (2026-09-15): the "grant APP_OWNER
// to an existing, already-ACTIVE Platform Admin" variant of the first-owner
// bootstrap problem -- for when the operator's authorized decision is that
// the overall PCA owner identity should hold BOTH APP_OWNER and
// PLATFORM_ADMIN on the SAME account, rather than a brand-new APP_OWNER
// account being created. NOT wired into `npm start`/main.ts and NOT
// reachable from any public path -- run manually by an operator with direct
// database access, exactly once per environment, exactly like the sibling
// bootstrap-platform-owner.mjs it deliberately shares its advisory lock
// with.
//
// WHY THIS SHARES bootstrap-platform-owner.mjs's LOCK AND PRECONDITION CODE
// (imported, not reimplemented): both scripts mutate the same "does an
// active APP_OWNER exist yet" invariant. If they used separate locks, two
// operators (or one operator running both by mistake) could race a
// brand-new-account bootstrap against an existing-account promotion and
// end up with two active owners. Sharing the exact lock name
// (FIRST_OWNER_BOOTSTRAP_LOCK_NAME) and the exact precondition check
// (assertNoExistingAppOwner) makes that impossible by construction, not by
// convention.
//
// WHY THIS NEVER TOUCHES PASSWORD/MFA: the target account already exists,
// already has whatever password/MFA state it has, and this script's only
// database writes are one new platform_admin_role_assignments row (APP_OWNER)
// and one ADMIN_ROLE_CHANGED audit event -- see
// MySqlFirstOwnerPromotionRepository.ts's own header for the full rationale.
// The account's existing PLATFORM_ADMIN role, password credential, and MFA
// state are never read for writing and never modified.
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { hashAdminEmail } from '../dist/platformadmin/auth/emailHash.js';
import { promoteExistingAccountToFirstOwner, FirstOwnerPromotionError } from '../dist/platformadmin/auth/MySqlFirstOwnerPromotionRepository.js';
import { closePool, getPool } from '../dist/db/pool.js';
import {
  FIRST_OWNER_BOOTSTRAP_LOCK_NAME,
  acquireBootstrapLock,
  releaseBootstrapLock,
  assertNoExistingAppOwner,
} from './bootstrap-platform-owner.mjs';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to run promote-first-app-owner.mjs.`);
  return value;
}

export async function runPromotion() {
  requireEnv('PCA_DATABASE_URL');
  const email = requireEnv('FIRST_OWNER_PROMOTION_EMAIL').trim().toLowerCase();
  const emailHash = hashAdminEmail(email);
  const now = new Date();
  const assignmentId = randomUUID();
  const auditEventId = randomUUID();
  const correlationId = randomUUID();

  const pool = getPool();
  const lock = await acquireBootstrapLock(pool);
  try {
    await assertNoExistingAppOwner(lock);
    const result = await promoteExistingAccountToFirstOwner({
      emailHash,
      assignmentId,
      grantedAt: now,
      auditEventId,
      correlationId,
    });
    return { previousRoleCount: result.previousRoles.length, newRoleCount: result.newRoles.length };
  } finally {
    await releaseBootstrapLock(lock);
  }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  runPromotion()
    .then((result) => console.log(`FIRST_OWNER_PROMOTION=COMPLETED PREVIOUS_ROLE_COUNT=${result.previousRoleCount} NEW_ROLE_COUNT=${result.newRoleCount}`))
    .then(() => closePool())
    .catch(async (error) => {
      if (error instanceof FirstOwnerPromotionError) {
        console.error(`FIRST_OWNER_PROMOTION=REFUSED REASON=${error.reason}`);
      } else {
        console.error(error instanceof Error ? error.message : 'First-owner promotion failed.');
      }
      await closePool();
      process.exitCode = 1;
    });
}
