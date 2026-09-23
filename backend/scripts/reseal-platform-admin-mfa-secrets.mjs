// PCA MFA key-rotation drain audit (reviewer finding F1, HIGH; raised
// independently by Codex and Claude).
//
// WHY THIS SCRIPT EXISTS
// ----------------------
// Read repair is decrypt-driven: a row is only re-sealed under the active key
// when something actually decrypts it. A dormant ACTIVE admin therefore keeps
// their secret sealed under the previous key with nothing to reveal that, so
// clearing PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1 is otherwise a blind act that
// can lock an operator out of the admin plane permanently. This script is the
// missing evidence: it reports, as COUNTS ONLY, how many rows still depend on a
// previous generation and how many are unreadable, and can optionally perform
// the same CAS reseal the login path would have performed.
//
// READ-ONLY BY DEFAULT. `--apply` is required to write anything, and the only
// write it can ever perform is resealMfaSecretCiphertext's guarded CAS.
//
// OUTPUT IS COUNTS ONLY, BY CONSTRUCTION. The classification lives in
// scripts/lib/mfaSecretDrainAudit.mjs, whose summarize() reads only `outcome`
// and `keySource`. This script prints that summary and nothing else: no admin
// id, no ciphertext, no nonce, no plaintext secret, no key material, and never
// which admins are affected. That is what makes the output safe to paste into
// an incident channel.
//
// THIS SCRIPT DOES READ THE MFA KEY, UNLIKE recover-platform-admin-activation.mjs
// which deliberately does not. The difference is unavoidable and intentional:
// establishing whether a key is still load-bearing requires attempting a
// decryption with it. It therefore never prints anything derived from a
// successful or failed decryption except a count and a key-generation NAME.
//
// OPERATOR CONTRACT (read before running):
//   * Run the dry run first. It writes nothing and exits non-zero if anything
//     still depends on a previous key.
//   * Do NOT clear PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1 while this exits
//     non-zero. Zero legacy and zero undecryptable counts are the precondition
//     for retirement, per the rotation procedure in the deployment runbook.
//   * Expected rotation order: set the new ACTIVE, move the outgoing key into
//     PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1, deploy, run this with --apply until
//     the legacy count reaches zero, THEN retire PREVIOUS_1 deliberately.
//     Clearing it in the same change as the rotation is the failure this
//     script exists to prevent.
//   * --apply is safe to re-run: the CAS makes a second run a no-op for rows
//     already resealed, and a lost race is treated as benign.
import { closePool, execute, runInTransaction } from '../dist/db/pool.js';
import { MySqlAuthRepository } from '../dist/platformadmin/auth/MySqlAuthRepository.js';
import { loadMfaEncryptionKeyring } from '../dist/platformadmin/auth/totp.js';
import { repairMfaSecretCiphertext } from '../dist/platformadmin/auth/mfaSecretReadRepair.js';
import { auditRow, exitCodeFor, summarize } from './lib/mfaSecretDrainAudit.mjs';

const APPLY = process.argv.includes('--apply');

async function main() {
  // Fail closed on a misconfigured ring BEFORE touching the database: a malformed
  // legacy slot must refuse outright rather than be silently skipped, for the
  // same reason the runtime does.
  const keyring = loadMfaEncryptionKeyring(process.env);

  const { rows } = await runInTransaction((conn) =>
    execute(
      conn,
      // EITHER field non-null, NOT both. Schema 0005 and schema.ts allow each
      // column to be null independently and declare no pair constraint, so an
      // AND predicate makes a half-written row INVISIBLE -- the audit would then
      // exit 0, report retirementSafe, and be wrong while a malformed sealed row
      // still existed. auditRow already classifies an incomplete pair as
      // UNDECRYPTABLE, so the predicate only has to let it reach the classifier.
      `SELECT admin_id, totp_secret_ciphertext, totp_secret_nonce
         FROM platform_admin_mfa_state
        WHERE totp_secret_ciphertext IS NOT NULL
           OR totp_secret_nonce IS NOT NULL`,
    ),
  );

  const repository = new MySqlAuthRepository();
  // Classified exactly ONCE per row. admin_id IS read, because the CAS predicate
  // needs it -- but it never reaches the output, because summarize() reads only
  // `outcome` and `keySource`. That is the structural guarantee: there is no
  // field through which an id, a ciphertext or a secret could be printed, so the
  // count-only property does not depend on anyone remembering.
  const entries = rows.map((row) => ({
    row,
    classification: auditRow({ ciphertext: row.totp_secret_ciphertext, nonce: row.totp_secret_nonce, keyring }),
  }));

  let repaired = 0;
  let repairLost = 0;
  if (APPLY) {
    // One guarded CAS per still-legacy row. Re-running is a no-op for anything
    // already resealed, and anything that remains legacy afterwards is still
    // reported by the summary below -- so this is idempotent rather than a
    // one-shot that can leave a silent remainder.
    for (const entry of entries) {
      if (entry.classification.outcome !== 'LEGACY') continue;
      const ok = await repairMfaSecretCiphertext(repository, {
        adminId: entry.row.admin_id,
        keyring,
        observedCiphertext: entry.row.totp_secret_ciphertext,
        observedNonce: entry.row.totp_secret_nonce,
        secret: entry.classification.secret,
      });
      if (ok) repaired += 1;
      else repairLost += 1;
    }
  }

  const summary = summarize(entries.map((entry) => entry.classification));
  const exitCode = exitCodeFor(summary);

  // The ONLY output. Counts, plus key-generation names, plus the mode.
  process.stdout.write(
    `${JSON.stringify(
      {
        event: 'MFA_SECRET_DRAIN_AUDIT',
        mode: APPLY ? 'APPLY' : 'DRY_RUN',
        // These counts describe the state BEFORE any repair performed by THIS
        // run, so a successful --apply still reports legacy > 0 and exits 3. That
        // is deliberately conservative: the retirement verdict must come from a
        // FRESH dry run after apply, never from the run that did the writing.
        total: summary.total,
        byKeySource: summary.byKeySource,
        legacy: summary.legacy,
        undecryptable: summary.undecryptable,
        repaired,
        repairLost,
        countsArePreApply: true,
        retirementSafe: exitCode === 0,
      },
      null,
      2,
    )}\n`,
  );

  if (exitCode !== 0) {
    process.stderr.write(
      summary.undecryptable > 0
        ? 'REFUSING: at least one MFA row could not be decrypted with any permitted key.\n'
        : 'REFUSING: at least one MFA row is still sealed under a previous key; do NOT retire PLATFORM_ADMIN_MFA_ENC_KEY_PREVIOUS_1.\n',
    );
  }
  return exitCode;
}

main()
  .then(async (code) => {
    await closePool();
    process.exit(code);
  })
  .catch(async (error) => {
    // The message is a configuration/connection error from the ring or the pool,
    // never row content: no row data is ever passed to an Error here.
    process.stderr.write(`${error instanceof Error ? error.message : 'drain audit failed'}\n`);
    await closePool().catch(() => {});
    process.exit(1);
  });
