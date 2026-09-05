-- PCA-LIVE-DB-0 owner decision (canonical-schema mission,
-- PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md section 8): closes the one
-- relationship that mission flagged OWNER_DECISION_REQUIRED rather than
-- silently resolving it.
--
-- enrollment_bootstrap_attempts.invitation_id has never been foreign-keyed
-- to enrollment_invitations.invitation_id, unlike this SAME table's
-- device_id column, which migration 0003 already FK's to devices(device_id).
-- No comment, test, or design doc in the repository explained the omission
-- (verified during the canonical-schema mission's relationship audit), and
-- none of the reasons that justify every OTHER unenforced relationship in
-- this schema apply here:
--
--  * it is not the schema-wide soft family_id convention (section 2) --
--    this is a device-identity relationship, not a family-scope one;
--  * it is not the reserve-before-existence ordering migration 0006 uses
--    for managed_device_slot_reservations.invitation_id -- 0003's own
--    header states this row is written "in the SAME transaction as
--    invitation redemption", at which point the invitation already exists
--    (being transitioned to REDEEMED, never deleted);
--  * types match exactly: both are CHAR(36) CHARACTER SET ascii COLLATE
--    ascii_bin, the same opaque-UUID convention (migration 0001 TYPE
--    DECISIONS), so there is no charset/collation incompatibility of the
--    kind that blocks an FK to families.family_id elsewhere in this schema;
--  * runtime replay/recovery (MySqlEnrollmentCoordinatorRepository) already
--    joins an attempt row back to its invitation, so the application
--    already depends on that reference resolving -- the FK only makes an
--    existing assumption durable.
--
-- OWNER DECISION: add the FK. A new migration, not a retroactive edit of
-- 0003 (this schema's history is never edited after the fact -- see
-- PCA_CANONICAL_SCHEMA_REPORT.md's Authority Model).
--
-- No backfill/cleanup step is included: no live PCA database exists yet
-- (this migration predates first production creation), so there is no
-- possibility of a pre-existing orphaned attempt row for this constraint to
-- reject.
ALTER TABLE enrollment_bootstrap_attempts
  ADD KEY enrollment_bootstrap_attempts_invitation_id_idx (invitation_id),
  ADD CONSTRAINT enrollment_bootstrap_attempts_invitation_id_fk
    FOREIGN KEY (invitation_id) REFERENCES enrollment_invitations (invitation_id)
    ON UPDATE NO ACTION ON DELETE NO ACTION;
