import { runInTransaction } from '../../db/pool.js';
import { insertPlatformAdminAccountOnConnection } from './MySqlAuthRepository.js';
import { issueActivationTokenOnConnection } from './MySqlPlatformAdminActivationRepository.js';
import { insertEmailOutboxRowOnConnection } from '../../email/MySqlEmailOutboxRepository.js';
import type { CreateAccountInput } from './AuthRepository.js';
import type { PlatformAdminAccountRecord } from './types.js';
import type { InsertEmailOutboxInput, InsertEmailOutboxOutcome } from '../../email/EmailOutboxRepository.js';

export interface CreateFirstOwnerBootstrapInput {
  readonly account: CreateAccountInput;
  readonly activation: { readonly activationId: string; readonly tokenHash: string; readonly createdAt: Date; readonly expiresAt: Date };
  readonly outboxEmail: InsertEmailOutboxInput;
}

export interface CreateFirstOwnerBootstrapResult {
  readonly account: PlatformAdminAccountRecord;
  readonly outboxOutcome: InsertEmailOutboxOutcome;
}

/**
 * PCA-PA-1 stranding fix: the single atomic commit boundary for
 * first-owner bootstrap. Account creation, the APP_OWNER role assignment,
 * PENDING_SETUP MFA state, bootstrap audit events, the first activation
 * token, and the durable email-outbox row are all persisted in ONE
 * `runInTransaction` call. If any of them fails -- for any reason -- every
 * one of them rolls back together; there is no longer a database state in
 * which an APP_OWNER account exists without also having a usable (or at
 * least durably enqueued, retryable) activation path.
 *
 * Before this existed, `scripts/bootstrap-platform-owner.mjs` called
 * `MySqlPlatformAdminAuthRepository.createAccount` and
 * `MySqlPlatformAdminActivationRepository.issue` as two SEPARATE
 * transactions. A failure in the second one (a real, reproduced,
 * DB-backed finding -- see
 * docs/supervision/PCA_FIRST_APP_OWNER_BOOTSTRAP_DB_CERTIFICATION_2026-09-15.md)
 * left a permanently active, permanently un-activatable APP_OWNER behind:
 * re-running the bootstrap script refuses (an active owner already
 * exists), and the only other issuance path
 * (`PlatformAdminActivationService.issueActivation`) requires an already
 * authenticated actor holding `MANAGE_ADMIN_ACCOUNTS`, which cannot exist
 * for a genuinely first-ever owner.
 *
 * Deliberately reuses the SAME connection-scoped helpers
 * (`insertPlatformAdminAccountOnConnection`,
 * `issueActivationTokenOnConnection`, `insertEmailOutboxRowOnConnection`)
 * that `createAccount`/`issue`/`insert` themselves wrap in their own
 * single-operation transactions -- one source of truth for each insert
 * group, reused here inside a wider transaction instead of duplicated.
 *
 * Deliberately does NOT attempt provider delivery (SMTP/Graph/etc.) --
 * that is a network call, and a database transaction must never stay open
 * across one. The caller (`scripts/bootstrap-platform-owner.mjs`) commits
 * this transaction and releases the advisory lock FIRST, then attempts
 * immediate delivery afterward via the ordinary outbox delivery path
 * (`attemptDeliveryAndRecordOutcome`) -- exactly like any other outbox
 * message. If that later delivery attempt fails, the durable, already
 * committed outbox row remains retryable by the background worker; the
 * APP_OWNER is not stranded, because everything durable it needs to
 * eventually get an activation link already committed atomically with it.
 */
export async function createFirstOwnerBootstrap(input: CreateFirstOwnerBootstrapInput): Promise<CreateFirstOwnerBootstrapResult> {
  return runInTransaction(async (conn) => {
    const account = await insertPlatformAdminAccountOnConnection(conn, input.account);
    await issueActivationTokenOnConnection(conn, {
      activationId: input.activation.activationId,
      adminId: input.account.adminId,
      tokenHash: input.activation.tokenHash,
      createdAt: input.activation.createdAt,
      expiresAt: input.activation.expiresAt,
    });
    const outboxOutcome = await insertEmailOutboxRowOnConnection(conn, input.outboxEmail);
    // insertEmailOutboxRowOnConnection treats ANY ER_DUP_ENTRY (whether on
    // outbox_id's primary key or idempotency_key's unique constraint) as a
    // soft 'DUPLICATE_IDEMPOTENCY_KEY' outcome rather than throwing -- the
    // correct behavior for EmailService's ordinary "this exact send was
    // already durably enqueued once" dedup case, where the row that already
    // exists at that key IS this same logical message. Bootstrap has no
    // such prior-attempt history to defer to: a non-INSERTED outcome here
    // means the durable outbox row this owner's activation email depends on
    // does not exist, so the whole bootstrap must roll back rather than
    // leave an APP_OWNER whose activation link was never durably enqueued.
    if (outboxOutcome !== 'INSERTED') {
      throw new Error(`createFirstOwnerBootstrap: durable activation-email outbox enqueue did not insert a new row (outcome=${outboxOutcome}); rolling back the entire first-owner bootstrap.`);
    }
    return { account, outboxOutcome };
  });
}
