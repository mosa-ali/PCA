-- Persist the authenticated Parent account that opened or decided a
-- removal/protection request. Historical rows and device-originated signed
-- decisions remain NULL; no request or personal profile data is backfilled.
ALTER TABLE enrollment_protection_approval_requests
  ADD COLUMN requested_by_parent_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER family_id,
  ADD COLUMN decided_by_parent_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER temporary_disable_until,
  ADD KEY enrollment_protection_approval_requested_by_parent_idx (requested_by_parent_account_id),
  ADD KEY enrollment_protection_approval_decided_by_parent_idx (decided_by_parent_account_id),
  ADD CONSTRAINT enrollment_protection_approval_requested_by_parent_fk
    FOREIGN KEY (requested_by_parent_account_id) REFERENCES parent_accounts (account_id),
  ADD CONSTRAINT enrollment_protection_approval_decided_by_parent_fk
    FOREIGN KEY (decided_by_parent_account_id) REFERENCES parent_accounts (account_id);
