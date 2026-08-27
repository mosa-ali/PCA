-- PCA product-completion programme, Writer P0-A (family-authority backend
-- foundation): a family-member invitation lifecycle, mechanically cloned
-- from enrollment_invitations' shape (migration 0001) but scoped to a
-- *person* (invited by email, with a role) rather than a *device*. See
-- docs/product-completion/PCA_FAMILY_AUTHORITY_COMPLETION_ARCHITECTURE.md's
-- MEMBERSHIP_PERSISTENCE / INVITATION_LIFECYCLE sections.
--
-- Distinct from enrollment_invitations: this table's subject is
-- (family_id, invited_email_hash, role), never a device or pairing key. A
-- member invitation, once accepted, does not by itself grant trust-set
-- membership -- the invited person still has to enroll/pair a device
-- through the existing enrollment_invitations flow before
-- TrustSetRoleResolver can resolve any role for them; this table only
-- carries the pre-trust-set "invited, not yet paired" state and the
-- audit-relevant record of who invited whom.
--
-- family_id/invited_by_account_id/accepted_by_account_id use CHAR(36)
-- ascii, matching families.family_id and parent_accounts.account_id
-- exactly (this table's actual integration point is parent_accounts, not
-- the device-oriented enrollment_invitations table, whose own family_id
-- column uses a different, looser VARCHAR(128) utf8mb4 type). No FOREIGN
-- KEY to families/parent_accounts, matching this schema's established
-- convention of soft (unenforced) family_id references across domain
-- boundaries -- see enrollment_invitations, devices, etc., none of which
-- FK to families either.
CREATE TABLE family_member_invitations (
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invited_email_hash BINARY(32) NOT NULL,
  role VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  invited_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  created_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  accepted_at DATETIME(3) NULL,
  expired_at DATETIME(3) NULL,
  revoked_at DATETIME(3) NULL,
  accepted_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (invitation_id),
  KEY family_member_invitations_family_id_idx (family_id),
  KEY family_member_invitations_email_hash_idx (invited_email_hash),
  CONSTRAINT family_member_invitations_role_check CHECK (role IN ('ADMINISTRATOR', 'VIEWER')),
  CONSTRAINT family_member_invitations_status_check CHECK (status IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED'))
) ENGINE=InnoDB;

-- ---------------------------------------------------------------------
-- Per-family override point for FamilyRbacPolicyConfig
-- (backend/src/familyrbac/types.ts). Previously only ever a hardcoded
-- closure default (defaultFamilyRbacPolicyConfig) shared across every
-- family regardless of familyId; this table makes it genuinely durable
-- and family-scoped. Absence of a row for a family means "use the safe
-- default" (both flags false, i.e. an Administrator cannot manage Viewers
-- or revoke/disable protection) -- see FamilyRbacPolicyConfigStore.ts.
-- ---------------------------------------------------------------------
CREATE TABLE family_rbac_policy_config (
  family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  administrator_can_manage_viewers TINYINT(1) NOT NULL DEFAULT 0,
  administrator_can_revoke_device_or_disable_protection TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id)
) ENGINE=InnoDB;
