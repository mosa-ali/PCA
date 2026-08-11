-- device_challenges
CREATE TABLE `device_challenges` (
  `challenge_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `nonce` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`challenge_id`),
  KEY `device_challenges_device_id_idx` (`device_id`),
  CONSTRAINT `device_challenges_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`),
  CONSTRAINT `device_challenges_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `device_challenges_nonce_check` CHECK ((char_length(`nonce`) between 1 and 256))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- device_public_keys
CREATE TABLE `device_public_keys` (
  `device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `key_purpose` varchar(8) COLLATE utf8mb4_bin NOT NULL,
  `public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`device_id`,`key_id`),
  UNIQUE KEY `device_public_keys_public_key_key` (`public_key`),
  KEY `device_public_keys_device_id_idx` (`device_id`),
  CONSTRAINT `device_public_keys_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`),
  CONSTRAINT `device_public_keys_key_purpose_check` CHECK ((`key_purpose` in (_utf8mb4'DSK',_utf8mb4'DEK'))),
  CONSTRAINT `device_public_keys_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- devices
CREATE TABLE `devices` (
  `device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `paired_at` datetime(3) DEFAULT NULL,
  `paired_by_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`device_id`),
  KEY `devices_family_id_idx` (`family_id`),
  KEY `devices_paired_by_account_id_fk` (`paired_by_account_id`),
  CONSTRAINT `devices_paired_by_account_id_fk` FOREIGN KEY (`paired_by_account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `devices_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `devices_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))),
  CONSTRAINT `devices_status_check` CHECK ((`status` in (_utf8mb4'PAIRING_PENDING',_utf8mb4'PAIRED',_utf8mb4'ACTIVE',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- enrollment_invitations
CREATE TABLE `enrollment_invitations` (
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `requested_protection_mode` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `opened_at` datetime(3) DEFAULT NULL,
  `redeemed_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`invitation_id`),
  UNIQUE KEY `enrollment_invitations_token_hash_key` (`token_hash`),
  KEY `enrollment_invitations_family_id_idx` (`family_id`),
  CONSTRAINT `enrollment_invitations_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_invitations_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))),
  CONSTRAINT `enrollment_invitations_protection_mode_check` CHECK ((`requested_protection_mode` in (_utf8mb4'ANDROID_STANDARD',_utf8mb4'ANDROID_PROTECTED',_utf8mb4'IOS_STANDARD'))),
  CONSTRAINT `enrollment_invitations_status_check` CHECK ((`status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'REDEEMED',_utf8mb4'REVOKED'))),
  CONSTRAINT `enrollment_invitations_token_hash_check` CHECK (regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- families
CREATE TABLE `families` (
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_reference_hash` varbinary(255) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`family_id`),
  UNIQUE KEY `families_family_reference_hash_key` (`family_reference_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- licenses
CREATE TABLE `licenses` (
  `license_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `license_reference_hash` varbinary(255) NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`license_id`),
  UNIQUE KEY `licenses_license_reference_hash_key` (`license_reference_hash`),
  KEY `licenses_account_id_idx` (`account_id`),
  CONSTRAINT `licenses_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `licenses_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'SUSPENDED',_utf8mb4'EXPIRED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- recovery_envelopes
CREATE TABLE `recovery_envelopes` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `version` int unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`),
  CONSTRAINT `recovery_envelopes_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `recovery_envelopes_version_check` CHECK ((`version` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- relay_envelopes
CREATE TABLE `relay_envelopes` (
  `message_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sender_device_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `recipient_device_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `state` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `acknowledged_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`message_id`),
  KEY `relay_envelopes_recipient_state_idx` (`recipient_device_id`,`state`,`expires_at`),
  CONSTRAINT `relay_envelopes_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `relay_envelopes_message_id_check` CHECK ((char_length(`message_id`) between 1 and 128)),
  CONSTRAINT `relay_envelopes_recipient_device_id_check` CHECK ((char_length(`recipient_device_id`) between 1 and 128)),
  CONSTRAINT `relay_envelopes_sender_device_id_check` CHECK ((char_length(`sender_device_id`) between 1 and 128)),
  CONSTRAINT `relay_envelopes_state_check` CHECK ((`state` in (_utf8mb4'QUEUED',_utf8mb4'ACKNOWLEDGED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- release_current_pointers
CREATE TABLE `release_current_pointers` (
  `package_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `version` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `version_major` int unsigned NOT NULL,
  `version_minor` int unsigned NOT NULL,
  `version_patch` int unsigned NOT NULL,
  `is_explicit_rollback` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`package_type`,`platform`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- release_packages
CREATE TABLE `release_packages` (
  `release_id` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `package_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `version` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `artifact_digest` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `artifact_size_bytes` bigint unsigned NOT NULL,
  `signing_key_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `signed_metadata` mediumblob NOT NULL,
  `minimum_supported_version` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `state` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `published_at` datetime(3) NOT NULL,
  `retired_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`release_id`),
  UNIQUE KEY `release_packages_identity_key` (`package_type`,`platform`,`version`),
  CONSTRAINT `release_packages_artifact_digest_check` CHECK (regexp_like(`artifact_digest`,_utf8mb4'^[0-9a-f]{64}$')),
  CONSTRAINT `release_packages_artifact_size_bytes_check` CHECK ((`artifact_size_bytes` > 0)),
  CONSTRAINT `release_packages_minimum_supported_version_check` CHECK (((`minimum_supported_version` is null) or regexp_like(`minimum_supported_version`,_utf8mb4'^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'))),
  CONSTRAINT `release_packages_package_type_check` CHECK ((`package_type` in (_utf8mb4'ANDROID_APP',_utf8mb4'IOS_APP',_utf8mb4'MODEL_PACKAGE',_utf8mb4'RULE_PACKAGE'))),
  CONSTRAINT `release_packages_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS',_utf8mb4'SHARED'))),
  CONSTRAINT `release_packages_release_id_check` CHECK ((char_length(`release_id`) between 1 and 256)),
  CONSTRAINT `release_packages_signing_key_id_check` CHECK ((char_length(`signing_key_id`) between 1 and 128)),
  CONSTRAINT `release_packages_state_check` CHECK ((`state` in (_utf8mb4'PUBLISHED',_utf8mb4'RETIRED'))),
  CONSTRAINT `release_packages_version_check` CHECK (regexp_like(`version`,_utf8mb4'^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- schema_migrations
CREATE TABLE `schema_migrations` (
  `version` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `applied_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- security_audit_metadata
CREATE TABLE `security_audit_metadata` (
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `actor_reference_hash` varbinary(255) DEFAULT NULL,
  `subject_reference_hash` varbinary(255) DEFAULT NULL,
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`event_id`),
  CONSTRAINT `security_audit_metadata_event_type_check` CHECK ((`event_type` in (_utf8mb4'ACCOUNT_DISABLED',_utf8mb4'DEVICE_REVOKED',_utf8mb4'KEY_REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- service_account_family_scopes
CREATE TABLE `service_account_family_scopes` (
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`account_id`,`family_id`),
  KEY `service_account_family_scopes_family_id_idx` (`family_id`),
  CONSTRAINT `service_account_family_scopes_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `service_account_family_scopes_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `service_account_family_scopes_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- service_accounts
CREATE TABLE `service_accounts` (
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_reference_hash` varbinary(255) NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `service_accounts_account_reference_hash_key` (`account_reference_hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- service_sessions
CREATE TABLE `service_sessions` (
  `session_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `service_sessions_token_hash_key` (`token_hash`),
  KEY `service_sessions_account_id_idx` (`account_id`),
  CONSTRAINT `service_sessions_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `service_sessions_token_hash_check` CHECK (regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
