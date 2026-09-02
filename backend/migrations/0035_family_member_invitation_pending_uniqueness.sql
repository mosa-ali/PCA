-- PCA family-member invitation concurrency: makes "at most one PENDING
-- invitation per (family_id, invited_email_hash)" a DATABASE invariant
-- instead of an application-level check-then-act.
--
-- WHY: migration 0027 gave this table only a plain, non-unique
-- `family_member_invitations_email_hash_idx`, and
-- FamilyMemberInvitationRepository.ts's own comment named
-- findPendingByFamilyAndEmailHash as the sole enforcement of the
-- duplicate-pending rule. That read, the seat-capacity read, and the INSERT
-- each ran in a SEPARATE transaction with no row locking, so two concurrent
-- createInvitation calls could both observe "no pending invitation" / "a
-- seat is free" and both insert -- producing a duplicate pending invitation,
-- and seats beyond the family's paid entitlement. Every other seat-consuming
-- path in this schema is already serialized (see
-- MySqlSlotReservationRepository's SELECT ... FOR UPDATE on
-- account_entitlements); this table was the exception.
--
-- The application side of the fix takes the row locks. This migration is
-- the backstop that holds even if a future caller forgets them, exactly as
-- `enrollment_invitations.token_hash`'s unique key backstops device
-- invitation issuance and `billing_provider_events`' unique key backstops
-- webhook idempotency.
--
-- PARTIAL-UNIQUENESS IN MYSQL: MySQL has no partial/filtered indexes, so
-- the constraint is expressed the standard way -- a generated column that
-- is the email hash only while the row is PENDING and NULL otherwise,
-- unique-indexed together with family_id. InnoDB treats NULLs as distinct
-- in a unique index, so any number of ACCEPTED/EXPIRED/REVOKED rows may
-- share a (family, email) pair; only PENDING ones collide. That is exactly
-- the rule the application already intended: an invitation that was
-- declined, expired, or revoked must be re-issuable.
--
-- The column is STORED, not VIRTUAL: it is written once at INSERT/UPDATE
-- time and read by the index directly, which keeps the uniqueness check on
-- the ordinary index path.

-- Collapse any duplicate PENDING rows that the pre-fix race may already
-- have produced -- a UNIQUE key cannot be added over existing violations.
-- Deterministic: the newest row per (family, email) survives (ties broken
-- by invitation_id), the rest take the EXPIRED transition this lifecycle
-- already defines for a superseded pending invitation. No row is deleted
-- and no accepted membership is touched.
UPDATE family_member_invitations AS dup
  JOIN (
    SELECT family_id,
           invited_email_hash,
           SUBSTRING_INDEX(GROUP_CONCAT(invitation_id ORDER BY created_at DESC, invitation_id DESC), ',', 1) AS keep_invitation_id
      FROM family_member_invitations
     WHERE status = 'PENDING'
     GROUP BY family_id, invited_email_hash
  ) AS keeper
    ON keeper.family_id = dup.family_id
   AND keeper.invited_email_hash = dup.invited_email_hash
   SET dup.status = 'EXPIRED',
       dup.expired_at = CURRENT_TIMESTAMP(3)
 WHERE dup.status = 'PENDING'
   AND dup.invitation_id <> keeper.keep_invitation_id;

ALTER TABLE family_member_invitations
  ADD COLUMN pending_invited_email_hash BINARY(32)
    GENERATED ALWAYS AS (CASE WHEN status = 'PENDING' THEN invited_email_hash ELSE NULL END) STORED,
  ADD UNIQUE KEY family_member_invitations_pending_email_key (family_id, pending_invited_email_hash);
