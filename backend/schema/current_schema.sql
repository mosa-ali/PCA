-- account_entitlements
CREATE TABLE `account_entitlements` (
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `plan_ref` varchar(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'FREE_STARTER',
  `parent_member_limit` int NOT NULL,
  `managed_device_limit` int NOT NULL,
  `parent_member_used_count` int NOT NULL DEFAULT '0',
  `managed_device_active_count` int NOT NULL DEFAULT '0',
  `managed_device_reserved_count` int NOT NULL DEFAULT '0',
  `over_limit_parent_member` tinyint(1) NOT NULL DEFAULT '0',
  `over_limit_managed_device` tinyint(1) NOT NULL DEFAULT '0',
  `revision` bigint NOT NULL DEFAULT '0',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`family_id`),
  CONSTRAINT `account_entitlements_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `account_entitlements_managed_device_active_count_check` CHECK ((`managed_device_active_count` >= 0)),
  CONSTRAINT `account_entitlements_managed_device_limit_check` CHECK ((`managed_device_limit` >= 0)),
  CONSTRAINT `account_entitlements_managed_device_reserved_count_check` CHECK ((`managed_device_reserved_count` >= 0)),
  CONSTRAINT `account_entitlements_parent_member_limit_check` CHECK ((`parent_member_limit` >= 0)),
  CONSTRAINT `account_entitlements_parent_member_used_count_check` CHECK ((`parent_member_used_count` >= 0)),
  CONSTRAINT `account_entitlements_plan_ref_check` CHECK ((char_length(`plan_ref`) between 1 and 32))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

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

-- enrollment_bootstrap_attempts
CREATE TABLE `enrollment_bootstrap_attempts` (
  `attempt_id` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recovery_token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `signing_public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `encryption_public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `signing_key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `encryption_key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`attempt_id`),
  UNIQUE KEY `enrollment_bootstrap_attempts_recovery_token_hash_key` (`recovery_token_hash`),
  KEY `enrollment_bootstrap_attempts_token_hash_idx` (`token_hash`),
  KEY `enrollment_bootstrap_attempts_device_id_idx` (`device_id`),
  CONSTRAINT `enrollment_bootstrap_attempts_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`),
  CONSTRAINT `enrollment_bootstrap_attempts_attempt_id_check` CHECK ((char_length(`attempt_id`) between 16 and 64)),
  CONSTRAINT `enrollment_bootstrap_attempts_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_bootstrap_attempts_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))),
  CONSTRAINT `enrollment_bootstrap_attempts_recovery_token_hash_check` CHECK (regexp_like(`recovery_token_hash`,_utf8mb4'^[0-9a-f]{64}$')),
  CONSTRAINT `enrollment_bootstrap_attempts_status_check` CHECK ((`status` = _utf8mb4'COMPLETED')),
  CONSTRAINT `enrollment_bootstrap_attempts_token_hash_check` CHECK (regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$'))
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

-- entitlement_activation_idempotency
CREATE TABLE `entitlement_activation_idempotency` (
  `idempotency_key` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `applied_managed_device_limit` int NOT NULL,
  `applied_at` datetime(3) NOT NULL,
  PRIMARY KEY (`idempotency_key`),
  KEY `entitlement_activation_idempotency_request_id_idx` (`request_id`),
  CONSTRAINT `entitlement_activation_idempotency_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `entitlement_change_requests` (`request_id`),
  CONSTRAINT `entitlement_activation_idempotency_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `entitlement_activation_idempotency_limit_check` CHECK ((`applied_managed_device_limit` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- entitlement_change_request_transitions
CREATE TABLE `entitlement_change_request_transitions` (
  `transition_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `from_state` varchar(20) COLLATE utf8mb4_bin DEFAULT NULL,
  `to_state` varchar(20) COLLATE utf8mb4_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `actor_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`transition_id`),
  KEY `entitlement_change_request_transitions_request_id_idx` (`request_id`),
  KEY `entitlement_change_request_transitions_actor_admin_id_fk` (`actor_admin_id`),
  CONSTRAINT `entitlement_change_request_transitions_actor_admin_id_fk` FOREIGN KEY (`actor_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `entitlement_change_request_transitions_request_id_fk` FOREIGN KEY (`request_id`) REFERENCES `entitlement_change_requests` (`request_id`),
  CONSTRAINT `entitlement_change_request_transitions_from_state_check` CHECK (((`from_state` is null) or (`from_state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED')))),
  CONSTRAINT `entitlement_change_request_transitions_to_state_check` CHECK ((`to_state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- entitlement_change_requests
CREATE TABLE `entitlement_change_requests` (
  `request_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `limit_type` varchar(24) COLLATE utf8mb4_bin NOT NULL,
  `current_limit_at_request` int NOT NULL,
  `target_limit` int NOT NULL,
  `state` varchar(20) COLLATE utf8mb4_bin NOT NULL,
  `awaiting_admin_quote` tinyint(1) NOT NULL DEFAULT '0',
  `no_charge_override` tinyint(1) NOT NULL DEFAULT '0',
  `quote_kind` varchar(16) COLLATE utf8mb4_bin DEFAULT NULL,
  `quote_ref` varchar(64) COLLATE utf8mb4_bin DEFAULT NULL,
  `quote_amount_minor` bigint DEFAULT NULL,
  `quote_currency_code` char(3) COLLATE utf8mb4_bin DEFAULT NULL,
  `quote_price_book_version` int unsigned DEFAULT NULL,
  `quoted_at` datetime(3) DEFAULT NULL,
  `quote_expires_at` datetime(3) DEFAULT NULL,
  `decided_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `decision_reason` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`request_id`),
  KEY `entitlement_change_requests_family_id_idx` (`family_id`),
  KEY `entitlement_change_requests_state_idx` (`state`),
  KEY `entitlement_change_requests_decided_by_admin_id_fk` (`decided_by_admin_id`),
  CONSTRAINT `entitlement_change_requests_decided_by_admin_id_fk` FOREIGN KEY (`decided_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `entitlement_change_requests_billable_check` CHECK (((`limit_type` <> _utf8mb4'PARENT_MEMBER_LIMIT') or (`quote_kind` is null))),
  CONSTRAINT `entitlement_change_requests_currency_code_check` CHECK (((`quote_currency_code` is null) or regexp_like(`quote_currency_code`,_utf8mb4'^[A-Z]{3}$'))),
  CONSTRAINT `entitlement_change_requests_current_limit_check` CHECK ((`current_limit_at_request` >= 0)),
  CONSTRAINT `entitlement_change_requests_decision_reason_check` CHECK (((`decision_reason` is null) or (char_length(`decision_reason`) between 1 and 255))),
  CONSTRAINT `entitlement_change_requests_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `entitlement_change_requests_limit_type_check` CHECK ((`limit_type` in (_utf8mb4'PARENT_MEMBER_LIMIT',_utf8mb4'MANAGED_DEVICE_LIMIT'))),
  CONSTRAINT `entitlement_change_requests_price_book_version_check` CHECK (((`quote_price_book_version` is null) or (`quote_price_book_version` > 0))),
  CONSTRAINT `entitlement_change_requests_quote_amount_check` CHECK (((`quote_amount_minor` is null) or (`quote_amount_minor` >= 0))),
  CONSTRAINT `entitlement_change_requests_quote_kind_check` CHECK (((`quote_kind` is null) or (`quote_kind` in (_utf8mb4'STANDARD',_utf8mb4'CUSTOM')))),
  CONSTRAINT `entitlement_change_requests_state_check` CHECK ((`state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED'))),
  CONSTRAINT `entitlement_change_requests_target_limit_check` CHECK ((`target_limit` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- entitlement_defaults
CREATE TABLE `entitlement_defaults` (
  `tier` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `parent_member_limit` int NOT NULL,
  `managed_device_limit` int NOT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`tier`),
  KEY `entitlement_defaults_updated_by_admin_id_fk` (`updated_by_admin_id`),
  CONSTRAINT `entitlement_defaults_updated_by_admin_id_fk` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `entitlement_defaults_managed_device_limit_check` CHECK ((`managed_device_limit` >= 0)),
  CONSTRAINT `entitlement_defaults_parent_member_limit_check` CHECK ((`parent_member_limit` >= 0)),
  CONSTRAINT `entitlement_defaults_tier_check` CHECK ((`tier` = _utf8mb4'FREE_STARTER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- envelope_data_version_ledger
CREATE TABLE `envelope_data_version_ledger` (
  `sender_key_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `last_accepted_version` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`,`sender_key_id`),
  CONSTRAINT `envelope_data_version_ledger_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `envelope_data_version_ledger_sender_key_id_check` CHECK ((char_length(`sender_key_id`) between 1 and 128)),
  CONSTRAINT `envelope_data_version_ledger_version_check` CHECK (regexp_like(`last_accepted_version`,_utf8mb4'^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- envelope_message_idempotency_ledger
CREATE TABLE `envelope_message_idempotency_ledger` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `message_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `canonical_bytes` mediumblob NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `envelope_message_idempotency_ledger_family_message_key` (`family_id`,`message_id`),
  CONSTRAINT `envelope_message_idempotency_ledger_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `envelope_message_idempotency_ledger_message_id_check` CHECK ((char_length(`message_id`) between 1 and 128))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- envelope_replay_ledger
CREATE TABLE `envelope_replay_ledger` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sender_key_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sequence_or_nonce` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `recorded_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `envelope_replay_ledger_family_sender_sequence_key` (`family_id`,`sender_key_id`,`sequence_or_nonce`),
  KEY `envelope_replay_ledger_family_sender_id_idx` (`family_id`,`sender_key_id`,`id`),
  CONSTRAINT `envelope_replay_ledger_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `envelope_replay_ledger_sender_key_id_check` CHECK ((char_length(`sender_key_id`) between 1 and 128)),
  CONSTRAINT `envelope_replay_ledger_sequence_or_nonce_check` CHECK ((char_length(`sequence_or_nonce`) between 1 and 128))
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

-- managed_device_slot_reservations
CREATE TABLE `managed_device_slot_reservations` (
  `reservation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  `released_at` datetime(3) DEFAULT NULL,
  `release_reason` varchar(24) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`reservation_id`),
  UNIQUE KEY `managed_device_slot_reservations_invitation_id_key` (`invitation_id`),
  KEY `managed_device_slot_reservations_family_id_status_idx` (`family_id`,`status`),
  CONSTRAINT `managed_device_slot_reservations_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `managed_device_slot_reservations_release_reason_check` CHECK (((`release_reason` is null) or (`release_reason` in (_utf8mb4'REVOKED',_utf8mb4'EXPIRED',_utf8mb4'ENROLLMENT_FAILED',_utf8mb4'ADMIN_ACTION')))),
  CONSTRAINT `managed_device_slot_reservations_status_check` CHECK ((`status` in (_utf8mb4'RESERVED',_utf8mb4'CONSUMED',_utf8mb4'RELEASED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_accounts
CREATE TABLE `platform_admin_accounts` (
  `admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `email_hash` varbinary(32) NOT NULL,
  `display_name` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `password_credential` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`admin_id`),
  UNIQUE KEY `platform_admin_accounts_email_hash_key` (`email_hash`),
  CONSTRAINT `platform_admin_accounts_display_name_check` CHECK ((char_length(`display_name`) between 1 and 128)),
  CONSTRAINT `platform_admin_accounts_password_credential_check` CHECK ((char_length(`password_credential`) between 1 and 255)),
  CONSTRAINT `platform_admin_accounts_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'DISABLED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_audit_events
CREATE TABLE `platform_admin_audit_events` (
  `event_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `event_type` varchar(40) COLLATE utf8mb4_bin NOT NULL,
  `actor_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `actor_role` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `target_ref` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `result` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `metadata_json` json DEFAULT NULL,
  PRIMARY KEY (`event_id`),
  KEY `platform_admin_audit_events_actor_admin_id_idx` (`actor_admin_id`),
  KEY `platform_admin_audit_events_event_type_idx` (`event_type`),
  KEY `platform_admin_audit_events_occurred_at_idx` (`occurred_at`),
  CONSTRAINT `platform_admin_audit_events_actor_admin_id_fk` FOREIGN KEY (`actor_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_audit_events_actor_role_check` CHECK (((`actor_role` is null) or (`actor_role` in (_utf8mb4'APP_OWNER',_utf8mb4'PLATFORM_ADMIN',_utf8mb4'FINANCE_ADMIN',_utf8mb4'SUPPORT_ADMIN',_utf8mb4'AUDITOR_READ_ONLY')))),
  CONSTRAINT `platform_admin_audit_events_event_type_check` CHECK ((`event_type` in (_utf8mb4'ADMIN_LOGIN',_utf8mb4'ADMIN_LOGIN_FAILED',_utf8mb4'ADMIN_CREATED',_utf8mb4'ADMIN_ROLE_CHANGED',_utf8mb4'ACCOUNT_SUSPENDED',_utf8mb4'ACCOUNT_REACTIVATED',_utf8mb4'DEVICE_LIMIT_CHANGED',_utf8mb4'LIMIT_REQUEST_APPROVED',_utf8mb4'LIMIT_REQUEST_DENIED',_utf8mb4'PLAN_CHANGED',_utf8mb4'PAYMENT_REFUNDED',_utf8mb4'BANK_SETTING_CHANGED',_utf8mb4'SETTING_CHANGED',_utf8mb4'PRICE_BOOK_CHANGED',_utf8mb4'QUOTE_ISSUED',_utf8mb4'PAYMENT_CONFIRMED',_utf8mb4'ENTITLEMENT_INCREASED',_utf8mb4'PAYMENT_ROLLED_BACK',_utf8mb4'ADMIN_SESSION_REVOKED',_utf8mb4'ADMIN_LOGIN_LOCKED_OUT',_utf8mb4'ADMIN_STEP_UP_GRANTED',_utf8mb4'ADMIN_STEP_UP_DENIED',_utf8mb4'ADMIN_MFA_ENROLLED'))),
  CONSTRAINT `platform_admin_audit_events_result_check` CHECK ((`result` in (_utf8mb4'SUCCESS',_utf8mb4'FAILURE',_utf8mb4'DENIED'))),
  CONSTRAINT `platform_admin_audit_events_target_ref_check` CHECK (((`target_ref` is null) or (char_length(`target_ref`) between 1 and 128)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_login_attempts
CREATE TABLE `platform_admin_login_attempts` (
  `attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `email_hash` varbinary(32) NOT NULL,
  `outcome` varchar(20) COLLATE utf8mb4_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`attempt_id`),
  KEY `platform_admin_login_attempts_email_hash_occurred_at_idx` (`email_hash`,`occurred_at`),
  CONSTRAINT `platform_admin_login_attempts_outcome_check` CHECK ((`outcome` in (_utf8mb4'SUCCESS',_utf8mb4'FAILED_CREDENTIALS',_utf8mb4'FAILED_MFA',_utf8mb4'LOCKED_OUT')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_mfa_state
CREATE TABLE `platform_admin_mfa_state` (
  `admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `totp_secret_ciphertext` varbinary(255) DEFAULT NULL,
  `totp_secret_nonce` varbinary(16) DEFAULT NULL,
  `activated_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_accepted_totp_counter` bigint DEFAULT NULL,
  PRIMARY KEY (`admin_id`),
  CONSTRAINT `platform_admin_mfa_state_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_mfa_state_status_check` CHECK ((`status` in (_utf8mb4'PENDING_SETUP',_utf8mb4'ACTIVE',_utf8mb4'DISABLED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_role_assignments
CREATE TABLE `platform_admin_role_assignments` (
  `assignment_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `role` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `granted_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `granted_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `active_role_marker` varchar(32) COLLATE utf8mb4_bin GENERATED ALWAYS AS ((case when (`revoked_at` is null) then `role` else NULL end)) STORED,
  PRIMARY KEY (`assignment_id`),
  UNIQUE KEY `platform_admin_role_assignments_admin_active_key` (`admin_id`,`active_role_marker`),
  KEY `platform_admin_role_assignments_admin_id_idx` (`admin_id`),
  KEY `platform_admin_role_assignments_granted_by_fk` (`granted_by_admin_id`),
  CONSTRAINT `platform_admin_role_assignments_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_role_assignments_granted_by_fk` FOREIGN KEY (`granted_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_role_assignments_role_check` CHECK ((`role` in (_utf8mb4'APP_OWNER',_utf8mb4'PLATFORM_ADMIN',_utf8mb4'FINANCE_ADMIN',_utf8mb4'SUPPORT_ADMIN',_utf8mb4'AUDITOR_READ_ONLY')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_sessions
CREATE TABLE `platform_admin_sessions` (
  `session_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `realm` varchar(24) COLLATE utf8mb4_bin NOT NULL,
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`session_id`),
  UNIQUE KEY `platform_admin_sessions_token_hash_key` (`token_hash`),
  KEY `platform_admin_sessions_admin_id_idx` (`admin_id`),
  CONSTRAINT `platform_admin_sessions_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_sessions_realm_check` CHECK ((`realm` = _utf8mb4'PLATFORM_ADMIN')),
  CONSTRAINT `platform_admin_sessions_token_hash_check` CHECK (regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- platform_admin_step_up_sessions
CREATE TABLE `platform_admin_step_up_sessions` (
  `step_up_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `session_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `scope` varchar(40) COLLATE utf8mb4_bin NOT NULL,
  `asserted_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`step_up_id`),
  KEY `platform_admin_step_up_sessions_admin_id_idx` (`admin_id`),
  KEY `platform_admin_step_up_sessions_session_id_idx` (`session_id`),
  CONSTRAINT `platform_admin_step_up_sessions_admin_id_fk` FOREIGN KEY (`admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_step_up_sessions_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `platform_admin_sessions` (`session_id`),
  CONSTRAINT `platform_admin_step_up_sessions_scope_check` CHECK ((`scope` in (_utf8mb4'REFUND',_utf8mb4'SETTLEMENT_BANK_CONFIG',_utf8mb4'ADMIN_ROLE_GRANT',_utf8mb4'FAMILY_ACCOUNT_SUSPEND',_utf8mb4'FAMILY_ACCOUNT_REACTIVATE',_utf8mb4'ENTITLEMENT_LIMIT_OVERRIDE')))
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

-- sync_sequence_progress_ledger
CREATE TABLE `sync_sequence_progress_ledger` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `sender_key_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `last_applied_sequence` bigint unsigned NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`,`sender_key_id`),
  CONSTRAINT `sync_sequence_progress_ledger_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `sync_sequence_progress_ledger_sender_key_id_check` CHECK ((char_length(`sender_key_id`) between 1 and 128))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
