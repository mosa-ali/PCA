-- PCA family-role completion (owner-approved source migration only).
--
-- Family roles are relationship-scoped.  They are deliberately not stored on
-- parent_accounts (an identity may participate in more than one family), and
-- family_member_invitations remains invitation lifecycle state rather than
-- active membership state.
CREATE TABLE family_parent_memberships (
  membership_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  service_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (membership_id),
  UNIQUE KEY family_parent_memberships_account_family_key (account_id, family_id),
  KEY family_parent_memberships_family_idx (family_id),
  KEY family_parent_memberships_service_account_idx (service_account_id),
  CONSTRAINT family_parent_memberships_family_fk FOREIGN KEY (family_id) REFERENCES families (family_id),
  CONSTRAINT family_parent_memberships_account_fk FOREIGN KEY (account_id) REFERENCES parent_accounts (account_id),
  CONSTRAINT family_parent_memberships_service_account_fk FOREIGN KEY (service_account_id) REFERENCES service_accounts (account_id),
  CONSTRAINT family_parent_memberships_role_check
    CHECK (role IN ('ADMINISTRATOR', 'VIEWER', 'CHILD')),
  CONSTRAINT family_parent_memberships_status_check
    CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;

-- Signup profile metadata only.  These fields never participate in role,
-- authorization, invitation, trust, or platform-role resolution.
ALTER TABLE parent_accounts
  ADD COLUMN account_type VARCHAR(24) NULL,
  ADD COLUMN estimated_child_count INT UNSIGNED NULL,
  ADD CONSTRAINT parent_accounts_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('PARENT_GUARDIAN', 'OTHER')),
  ADD CONSTRAINT parent_accounts_estimated_child_count_check
    CHECK (estimated_child_count IS NULL OR estimated_child_count <= 50);
