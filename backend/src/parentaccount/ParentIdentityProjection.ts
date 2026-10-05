/**
 * Parent-owned projection of the display identity selected for one family.
 * The family provisioning marker has precedence; legacy families resolve
 * only when exactly one enabled, verified ACTIVE Administrator is
 * identifiable. The public projection contains names, email, and nullable
 * phone only.
 *
 * Downstream callers MUST pass their dedicated authorization gate before
 * invoking this read model. Platform's route applies its RBAC gate first.
 * Email is opened only inside this backend boundary using the account-bound
 * identity encryption contract.
 */
import { execute, runInTransaction } from '../db/pool.js';
import {
  encryptParentDisplayEmail,
  openParentDisplayEmail,
  type EncryptedParentDisplayEmail,
  type OpenedParentDisplayEmail,
} from './identityContact.js';

export interface ParentIdentityDto {
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly email: string | null;
  readonly phoneNumber: string | null;
}

/** Persistence shape passed only between the private repository and mapper. */
export interface ParentIdentityReadRecord {
  readonly accountId: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly protectedDisplayEmail: EncryptedParentDisplayEmail | null;
  readonly phoneNumber: string | null;
}

export class ParentIdentityAmbiguousError extends Error {
  constructor() {
    super('Parent identity cannot be resolved uniquely for this family.');
    this.name = 'ParentIdentityAmbiguousError';
  }
}

export interface ParentIdentityReadRepository {
  /** Resolve identity within one family; callers cannot ask for arbitrary account identities. */
  findByFamilyId(familyId: string): Promise<ParentIdentityReadRecord | null>;
  /** Best-effort compare-and-swap that replaces only the observed encrypted display-email tuple. */
  repairProtectedDisplayEmail(
    accountId: string,
    expected: EncryptedParentDisplayEmail,
    replacement: EncryptedParentDisplayEmail,
  ): Promise<boolean>;
}

/** Capability contract consumed by authenticated downstream identity routes. */
export interface ParentIdentityProjection {
  getByFamilyId(familyId: string): Promise<ParentIdentityDto | null>;
}

interface ParentIdentitySqlRow {
  family_id: string;
  provisioned_for_account_id: string | null;
  selected_account_id: string | null;
  account_id: string | null;
  status: 'PENDING_VERIFICATION' | 'VERIFIED' | null;
  disabled_at: Date | null;
  first_name: string | null;
  last_name: string | null;
  protected_display_email_ciphertext: Buffer | null;
  protected_display_email_nonce: Buffer | null;
  protected_display_email_auth_tag: Buffer | null;
  phone_number: string | null;
}

/** Production repository uses an exact family key and selects only projection fields. */
export class MySqlParentIdentityReadRepository implements ParentIdentityReadRepository {
  async findByFamilyId(familyId: string): Promise<ParentIdentityReadRecord | null> {
    const { rows } = await runInTransaction((conn) =>
      execute<ParentIdentitySqlRow>(
        conn,
        `SELECT f.family_id, f.provisioned_for_account_id,
                COALESCE(f.provisioned_for_account_id, m.account_id) AS selected_account_id,
                pa.account_id, pa.status, pa.disabled_at, pa.first_name, pa.last_name,
                pa.protected_display_email_ciphertext, pa.protected_display_email_nonce,
                pa.protected_display_email_auth_tag, pa.phone_number
           FROM families f
           LEFT JOIN family_parent_memberships m
             ON f.provisioned_for_account_id IS NULL
            AND m.family_id = f.family_id
            AND m.status = 'ACTIVE'
            AND m.role = 'ADMINISTRATOR'
           LEFT JOIN parent_accounts pa
             ON pa.account_id = COALESCE(f.provisioned_for_account_id, m.account_id)
          WHERE f.family_id = ?
          ORDER BY m.account_id ASC`,
        [familyId],
      ),
    );

    if (rows.length === 0) return null;
    // Count active membership candidates before checking account usability so
    // two ACTIVE Administrators never become a silent single-candidate result
    // merely because one account is disabled or otherwise incomplete.
    const candidates = rows.filter((row) => row.selected_account_id !== null);
    if (candidates.length > 1) throw new ParentIdentityAmbiguousError();
    const selected = candidates[0];
    if (!selected || selected.account_id === null || selected.status !== 'VERIFIED' || selected.disabled_at !== null) return null;

    const emailCiphertext = selected.protected_display_email_ciphertext;
    const emailNonce = selected.protected_display_email_nonce;
    const emailAuthTag = selected.protected_display_email_auth_tag;
    const allEmailPartsAbsent = emailCiphertext === null && emailNonce === null && emailAuthTag === null;
    const allEmailPartsPresent = emailCiphertext !== null && emailNonce !== null && emailAuthTag !== null;
    if (!allEmailPartsAbsent && !allEmailPartsPresent) {
      throw new Error('Parent display email ciphertext columns are inconsistent.');
    }

    return {
      accountId: selected.account_id!,
      firstName: selected.first_name,
      lastName: selected.last_name,
      protectedDisplayEmail: allEmailPartsPresent
        ? {
            ciphertext: emailCiphertext as Buffer,
            nonce: emailNonce as Buffer,
            authTag: emailAuthTag as Buffer,
          }
        : null,
      phoneNumber: selected.phone_number,
    };
  }

  async repairProtectedDisplayEmail(
    accountId: string,
    expected: EncryptedParentDisplayEmail,
    replacement: EncryptedParentDisplayEmail,
  ): Promise<boolean> {
    const { rowCount } = await runInTransaction((conn) =>
      execute(
        conn,
        `UPDATE parent_accounts
            SET protected_display_email_ciphertext = ?,
                protected_display_email_nonce = ?,
                protected_display_email_auth_tag = ?
          WHERE account_id = ?
            AND protected_display_email_ciphertext = ?
            AND protected_display_email_nonce = ?
            AND protected_display_email_auth_tag = ?`,
        [
          replacement.ciphertext,
          replacement.nonce,
          replacement.authTag,
          accountId,
          expected.ciphertext,
          expected.nonce,
          expected.authTag,
        ],
      ),
    );
    return rowCount === 1;
  }
}

/**
 * Builds the only DTO this read model returns. Extra properties on repository
 * values are intentionally ignored; adding a database field cannot silently
 * widen the Platform API response.
 */
export function toParentIdentityDto(
  record: ParentIdentityReadRecord,
  displayEmail: string | null,
): ParentIdentityDto {
  return {
    firstName: record.firstName,
    lastName: record.lastName,
    email: displayEmail,
    phoneNumber: record.phoneNumber,
  };
}

export class ParentIdentityReadModel implements ParentIdentityProjection {
  private readonly repository: ParentIdentityReadRepository;
  private readonly openDisplayEmail: (accountId: string, encrypted: EncryptedParentDisplayEmail | null) => OpenedParentDisplayEmail | null;
  private readonly sealDisplayEmail: (accountId: string, email: string) => EncryptedParentDisplayEmail;

  constructor(
    repository: ParentIdentityReadRepository = new MySqlParentIdentityReadRepository(),
    openDisplayEmail: (accountId: string, encrypted: EncryptedParentDisplayEmail | null) => OpenedParentDisplayEmail | null = openParentDisplayEmail,
    sealDisplayEmail: (accountId: string, email: string) => EncryptedParentDisplayEmail = encryptParentDisplayEmail,
  ) {
    this.repository = repository;
    this.openDisplayEmail = openDisplayEmail;
    this.sealDisplayEmail = sealDisplayEmail;
  }

  /** Caller must already have passed Platform RBAC for Parent identity PII. */
  async getByFamilyId(familyId: string): Promise<ParentIdentityDto | null> {
    const record = await this.repository.findByFamilyId(familyId);
    if (!record) return null;
    const opened = this.openDisplayEmail(record.accountId, record.protectedDisplayEmail);
    if (opened?.needsReencryption && record.protectedDisplayEmail) {
      try {
        const replacement = this.sealDisplayEmail(record.accountId, opened.email);
        await this.repository.repairProtectedDisplayEmail(record.accountId, record.protectedDisplayEmail, replacement);
      } catch {
        // Key rotation repair is best-effort after authenticated decryption.
        // A CAS race or transient DB error never fails the authorized DTO read.
      }
    }
    return toParentIdentityDto(record, opened?.email ?? null);
  }
}
