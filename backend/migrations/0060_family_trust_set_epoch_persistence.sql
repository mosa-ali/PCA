-- 0060_family_trust_set_epoch_persistence.sql
-- Wave 5A: durable Family Trust Set signed-epoch persistence + epoch floors (additive only).
CREATE TABLE IF NOT EXISTS family_trust_set_epochs (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  trust_set_epoch INT UNSIGNED NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  supersedes_epoch INT UNSIGNED NULL,
  signed_epoch_bytes MEDIUMBLOB NOT NULL,
  signature VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  signer_key_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  signer_device_id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  received_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id, trust_set_epoch),
  KEY family_trust_set_epochs_key_epoch_idx (family_id, key_epoch),
  CONSTRAINT family_trust_set_epochs_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT family_trust_set_epochs_trust_set_epoch_check CHECK (trust_set_epoch >= 1),
  CONSTRAINT family_trust_set_epochs_key_epoch_check CHECK (key_epoch >= 1),
  CONSTRAINT family_trust_set_epochs_supersedes_check CHECK (supersedes_epoch IS NULL OR (supersedes_epoch >= 1 AND supersedes_epoch < trust_set_epoch)),
  CONSTRAINT family_trust_set_epochs_bytes_check CHECK (OCTET_LENGTH(signed_epoch_bytes) BETWEEN 1 AND 262144),
  CONSTRAINT family_trust_set_epochs_signature_check CHECK (CHAR_LENGTH(signature) BETWEEN 1 AND 512),
  CONSTRAINT family_trust_set_epochs_signer_key_check CHECK (CHAR_LENGTH(signer_key_id) BETWEEN 1 AND 64),
  CONSTRAINT family_trust_set_epochs_signer_device_check CHECK (CHAR_LENGTH(signer_device_id) BETWEEN 1 AND 64)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS family_epoch_floors (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  minimum_accepted_trust_set_epoch INT UNSIGNED NOT NULL,
  minimum_accepted_key_epoch INT UNSIGNED NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id),
  CONSTRAINT family_epoch_floors_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT family_epoch_floors_min_trust_set_epoch_check CHECK (minimum_accepted_trust_set_epoch >= 1),
  CONSTRAINT family_epoch_floors_min_key_epoch_check CHECK (minimum_accepted_key_epoch >= 1)
) ENGINE=InnoDB;
