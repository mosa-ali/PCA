-- PCA-ADD-ENR-005 / PCA-ADD-ENR-023 (Writer63): expands enrollment_invitations
-- lifecycle from the 4-state (CREATED/OPENED/REDEEMED/REVOKED) shape to the
-- full 8-state machine required by Addendum 001
-- (docs/implementation/addenda/PCA_ADDENDUM_001_SECURE_INVITE_PROTECTED_ENROLLMENT.md,
-- PCA-ADD-ENR-005): CREATED, OPENED, INSTALL_REQUIRED, APP_INSTALLED,
-- AUTHORIZATION_REQUIRED, REDEEMED, EXPIRED, REVOKED.
--
-- INSTALL_REQUIRED / APP_INSTALLED / AUTHORIZATION_REQUIRED are new real,
-- persisted, timestamped states (not derived), reachable via new
-- InvitationService transition methods used by the Android install/app-link
-- continuation flow (PCA-ADD-ENR-008) before redemption.
--
-- EXPIRED becomes a real, audited, persisted transition (see
-- enrollment_invitation_transitions below) instead of a value computed only
-- on read -- InvitationService now writes EXPIRED via
-- InvitationRepository.expireIfDue the first time any code path observes an
-- invitation past its expires_at while still in a non-terminal state, rather
-- than only ever reporting it transiently to the caller.
ALTER TABLE enrollment_invitations
  ADD COLUMN install_required_at DATETIME(3) NULL AFTER opened_at,
  ADD COLUMN app_installed_at DATETIME(3) NULL AFTER install_required_at,
  ADD COLUMN authorization_required_at DATETIME(3) NULL AFTER app_installed_at,
  ADD COLUMN expired_at DATETIME(3) NULL AFTER redeemed_at;

ALTER TABLE enrollment_invitations
  DROP CHECK enrollment_invitations_status_check;

ALTER TABLE enrollment_invitations
  ADD CONSTRAINT enrollment_invitations_status_check
    CHECK (status IN (
      'CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED',
      'AUTHORIZATION_REQUIRED', 'REDEEMED', 'EXPIRED', 'REVOKED'
    ));

-- ---------------------------------------------------------------------
-- Immutable per-invitation transition audit trail (PCA-ADD-ENR-005's
-- "validated transitions and immutable transition audit evidence" and
-- PCA-ADD-ENR-023's "auditable correlation identifiers"). Append-only:
-- application code never UPDATEs or DELETEs a row here. This is
-- deliberately separate from the mutable enrollment_invitations row itself
-- (which only ever holds the CURRENT state) so the full lifecycle history
-- survives every subsequent transition, including a later EXPIRED/REVOKED
-- terminal transition.
-- ---------------------------------------------------------------------
CREATE TABLE enrollment_invitation_transitions (
  transition_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_status VARCHAR(32) NOT NULL,
  to_status VARCHAR(32) NOT NULL,
  transitioned_at DATETIME(3) NOT NULL,
  PRIMARY KEY (transition_id),
  KEY enrollment_invitation_transitions_invitation_idx (invitation_id, transitioned_at),
  CONSTRAINT enrollment_invitation_transitions_invitation_fk
    FOREIGN KEY (invitation_id) REFERENCES enrollment_invitations (invitation_id),
  CONSTRAINT enrollment_invitation_transitions_from_status_check
    CHECK (from_status IN (
      'CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED',
      'AUTHORIZATION_REQUIRED', 'REDEEMED', 'EXPIRED', 'REVOKED'
    )),
  CONSTRAINT enrollment_invitation_transitions_to_status_check
    CHECK (to_status IN (
      'CREATED', 'OPENED', 'INSTALL_REQUIRED', 'APP_INSTALLED',
      'AUTHORIZATION_REQUIRED', 'REDEEMED', 'EXPIRED', 'REVOKED'
    ))
) ENGINE=InnoDB;
