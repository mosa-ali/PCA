-- PCA-FR-008 / PCA-ADD-ENR-001: bind an opaque child profile and controlled
-- initial UX/policy defaults to the one-time invitation. No display name,
-- activity, location, or readable child content is stored here.
ALTER TABLE enrollment_invitations
  ADD COLUMN child_profile_id VARCHAR(128) NULL AFTER family_id,
  ADD COLUMN age_ux_tier VARCHAR(16) NOT NULL DEFAULT 'YOUNG_CHILD' AFTER requested_protection_mode,
  ADD COLUMN initial_policy_profile VARCHAR(16) NOT NULL DEFAULT 'BALANCED' AFTER age_ux_tier,
  ADD KEY enrollment_invitations_family_child_idx (family_id, child_profile_id),
  ADD CONSTRAINT enrollment_invitations_child_profile_id_check
    CHECK (child_profile_id IS NULL OR child_profile_id REGEXP '^[A-Za-z0-9_-]{1,128}$'),
  ADD CONSTRAINT enrollment_invitations_age_ux_tier_check
    CHECK (age_ux_tier IN ('YOUNG_CHILD', 'TEEN')),
  ADD CONSTRAINT enrollment_invitations_initial_policy_profile_check
    CHECK (initial_policy_profile IN ('BALANCED', 'STRICT'));
