-- PPR-2 / CHG-2026-09-04-01 (doc 00 Section 9): the opaque central child-
-- profile membership registry. Owner-approved scope, quoted verbatim in
-- doc 10 Section 7.1: "The central service may maintain an opaque
-- child-profile membership registry consisting of a server-minted
-- childProfileId bound to familyId. No readable child-profile content is
-- permitted in the central service." This table holds exactly that and
-- nothing else -- no display name, nickname, date of birth, age, gender,
-- school, avatar, wellbeing, location, or usage/activity field may ever be
-- added to it under any name (see
-- backend/test/childprofiles/noReadableChildFieldsRegression.test.mjs,
-- which fails the build if one is). FamilyMember (doc 10 Section 3.2)
-- remains the authoritative readable child entity; this table is a
-- membership/existence edge only, never a ChildProfile record.
--
-- child_profile_id is VARCHAR(128) utf8mb4_bin -- not CHAR(36) -- to match
-- enrollment_invitations.child_profile_id's exact column type, charset and
-- collation (migration 0019_enrollment_profile_contract.sql), so an
-- application-layer lookup between the two never needs a cross-charset
-- comparison. The stored value is always a server-minted UUID
-- (crypto.randomUUID()); no caller-supplied id is ever accepted (a
-- caller-chosen id under a global PRIMARY KEY would turn a duplicate-entry
-- error into a cross-family existence oracle -- see doc 39 Section 5).
--
-- NO foreign key is added from enrollment_invitations.child_profile_id to
-- this table in this migration. That relationship is enforced at the
-- application layer (InvitationService, verified by
-- backend/test/childprofiles and backend/test/invitation) rather than at
-- the schema layer, because enrollment_invitations already carries rows
-- (pre-PPR-2 dev/fixture data, format-validated but not minted by this
-- registry) whose child_profile_id values this table cannot retroactively
-- host without risking a false cross-family bind -- see
-- docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F for the full
-- backfill assessment and why none is performed.
CREATE TABLE family_child_memberships (
  child_profile_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Caller-supplied only via the request's optional idempotency key, so a
  -- retried CREATE after a lost response returns the SAME row instead of
  -- minting a second child. Never used as the row's identity.
  creation_request_key VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (child_profile_id),
  KEY family_child_memberships_family_id_idx (family_id),
  -- No FK to families(family_id): verified against every other family-scoped
  -- table in this schema (enrollment_invitations, devices, device_challenges,
  -- relay_envelopes, recovery_envelopes, eye_protection_settings) -- NONE
  -- declares one. families.family_id is CHAR(36) ascii_bin (the opaque
  -- identity itself); every OTHER table's family_id column is VARCHAR(128)
  -- utf8mb4_bin (matching enrollment_invitations' own established type), and
  -- MySQL rejects an FK across that charset/collation difference outright.
  -- An index, not a foreign key, is this schema's consistent mechanism for a
  -- family-scoped column -- membership existence is checked at the
  -- application layer (AuthzService's requiresFamilyScope), same as every
  -- sibling table above.
  CONSTRAINT family_child_memberships_family_id_check
    CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT family_child_memberships_child_profile_id_check
    CHECK (child_profile_id REGEXP '^[A-Za-z0-9_-]{1,128}$'),
  -- Idempotent-retry safety, scoped per family: the same key reused for a
  -- different family must not silently resolve against the wrong family's
  -- child, so uniqueness is (family_id, creation_request_key), not global.
  -- Rows created without a key (creation_request_key IS NULL) are exempt --
  -- MySQL treats NULL as distinct from any other NULL in a UNIQUE index, so
  -- key-less creates are never deduplicated against each other, which is
  -- correct: a caller that never supplies a key has opted out of retry
  -- safety and each such call legitimately creates a new child.
  UNIQUE KEY family_child_memberships_family_creation_key (family_id, creation_request_key)
) ENGINE=InnoDB;
