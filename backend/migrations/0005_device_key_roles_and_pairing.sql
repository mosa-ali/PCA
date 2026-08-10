-- ENROLL-HARDEN-2: separate device key roles and correct device lifecycle
-- so enrollment-token submission alone can never make a device ACTIVE.
--
-- Per accepted architecture (doc 08 Section 3, doc 09 Section 3.1): a
-- Device Signing Key (DSK) and a Device Encryption/Key-Agreement Key (DEK)
-- are distinct roles, never one generic key pair -- DSK signs trust-set
-- epochs/policy/receipts, DEK receives FDEK envelopes. Device lifecycle is
-- NEW -> INVITED -> PAIRED -> ACTIVE; PAIRED requires device key
-- submission AND parent confirmation (doc 08 PCA-FR-141 fingerprint
-- check); ACTIVE requires first policy delivery, which depends on the
-- Family Trust Set workstream and is not implemented yet. Enrollment-token
-- submission alone therefore produces PAIRING_PENDING, never ACTIVE.

ALTER TABLE device_public_keys
  ADD COLUMN key_purpose TEXT NOT NULL DEFAULT 'DSK' CHECK (key_purpose IN ('DSK', 'DEK'));
ALTER TABLE device_public_keys ALTER COLUMN key_purpose DROP DEFAULT;

ALTER TABLE devices DROP CONSTRAINT devices_status_check;
ALTER TABLE devices ADD CONSTRAINT devices_status_check
  CHECK (status IN ('PAIRING_PENDING', 'PAIRED', 'ACTIVE', 'REVOKED'));

-- Parent confirmation record (doc 08 Section 4 "Owner confirms" step).
-- paired_by_account_id is the SERVICE account of the confirming parent --
-- this is confirmation bookkeeping only, never family E2EE trust
-- authority (that remains the device-side Family Trust Set, doc 09
-- Section 3.2).
ALTER TABLE devices ADD COLUMN paired_at TIMESTAMPTZ;
ALTER TABLE devices ADD COLUMN paired_by_account_id UUID REFERENCES service_accounts (account_id);
