-- Trusted-browser endpoint registration (doc 08 Section 8-style device
-- ceremony, extended to admit a service-authenticated browser endpoint
-- alongside ANDROID/IOS managed devices). Every previously-accepted
-- platform value is preserved verbatim.
ALTER TABLE devices
  DROP CHECK devices_platform_check,
  ADD CONSTRAINT devices_platform_check CHECK (platform IN ('ANDROID', 'IOS', 'BROWSER'));

-- No-self-approval enforcement: a BROWSER endpoint is registered under the
-- SAME parent service session that will later confirm it is, by
-- construction, a self-approval risk mobile enrollment never has (a child
-- device claiming an invitation authenticates only as the one-time
-- invitation bearer -- it has no parent service session at all, see
-- authz/types.ts's ServiceOperation doc comment). registered_by_account_id
-- records which account requested registration so confirmPairing can
-- reject a confirmation from that SAME account -- NULL for every
-- invitation-enrolled device (no service session exists at that point),
-- populated only for a BROWSER endpoint registered via the new
-- registration route.
ALTER TABLE devices
  ADD COLUMN registered_by_account_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER paired_by_account_id,
  ADD CONSTRAINT devices_registered_by_account_id_fk FOREIGN KEY (registered_by_account_id) REFERENCES service_accounts (account_id);
