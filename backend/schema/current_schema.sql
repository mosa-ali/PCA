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

-- billing_commercial_markets
CREATE TABLE `billing_commercial_markets` (
  `commercial_market` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `default_currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`commercial_market`),
  KEY `billing_commercial_markets_currency_fk` (`default_currency_code`),
  CONSTRAINT `billing_commercial_markets_currency_fk` FOREIGN KEY (`default_currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_commercial_markets_market_check` CHECK ((`commercial_market` in (_utf8mb4'YEMEN',_utf8mb4'GULF',_utf8mb4'GLOBAL_OTHER')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_country_market_rules
CREATE TABLE `billing_country_market_rules` (
  `country_code` char(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `commercial_market` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`country_code`),
  KEY `billing_country_market_rules_market_fk` (`commercial_market`),
  CONSTRAINT `billing_country_market_rules_market_fk` FOREIGN KEY (`commercial_market`) REFERENCES `billing_commercial_markets` (`commercial_market`),
  CONSTRAINT `billing_country_market_rules_country_check` CHECK (regexp_like(`country_code`,_utf8mb4'^[A-Z]{2}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_currencies
CREATE TABLE `billing_currencies` (
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `minor_unit_exponent` tinyint unsigned NOT NULL,
  `enabled` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`currency_code`),
  CONSTRAINT `billing_currencies_code_check` CHECK (regexp_like(`currency_code`,_utf8mb4'^[A-Z]{3}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_disputes
CREATE TABLE `billing_disputes` (
  `dispute_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `evidence_submitted_at` datetime(3) DEFAULT NULL,
  `evidence_due_at` datetime(3) DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`dispute_id`),
  KEY `billing_disputes_transaction_idx` (`payment_transaction_id`),
  CONSTRAINT `billing_disputes_transaction_fk` FOREIGN KEY (`payment_transaction_id`) REFERENCES `billing_payment_transactions` (`payment_transaction_id`),
  CONSTRAINT `billing_disputes_status_check` CHECK ((`status` in (_utf8mb4'OPEN',_utf8mb4'UNDER_REVIEW',_utf8mb4'WON',_utf8mb4'LOST')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_invoice_lines
CREATE TABLE `billing_invoice_lines` (
  `invoice_line_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invoice_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `line_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `quantity` int unsigned NOT NULL DEFAULT '1',
  `plan_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `price_book_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`invoice_line_id`),
  KEY `billing_invoice_lines_invoice_id_idx` (`invoice_id`),
  KEY `billing_invoice_lines_currency_fk` (`currency_code`),
  KEY `billing_invoice_lines_plan_fk` (`plan_id`),
  KEY `billing_invoice_lines_price_book_fk` (`price_book_id`),
  CONSTRAINT `billing_invoice_lines_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_invoice_lines_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`invoice_id`),
  CONSTRAINT `billing_invoice_lines_plan_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans` (`plan_id`),
  CONSTRAINT `billing_invoice_lines_price_book_fk` FOREIGN KEY (`price_book_id`) REFERENCES `billing_price_books` (`price_book_id`),
  CONSTRAINT `billing_invoice_lines_description_check` CHECK ((char_length(`description`) between 1 and 255)),
  CONSTRAINT `billing_invoice_lines_line_type_check` CHECK ((`line_type` in (_utf8mb4'PLAN_CHARGE',_utf8mb4'PRORATION',_utf8mb4'DEVICE_LIMIT_INCREASE',_utf8mb4'CREDIT',_utf8mb4'OTHER'))),
  CONSTRAINT `billing_invoice_lines_quantity_check` CHECK ((`quantity` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_invoices
CREATE TABLE `billing_invoices` (
  `invoice_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `subscription_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `total_amount_minor` bigint NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `due_at` datetime(3) DEFAULT NULL,
  `period_start` datetime(3) DEFAULT NULL,
  `period_end` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`invoice_id`),
  KEY `billing_invoices_account_ref_idx` (`account_ref`),
  KEY `billing_invoices_subscription_fk` (`subscription_id`),
  KEY `billing_invoices_currency_fk` (`currency_code`),
  CONSTRAINT `billing_invoices_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_invoices_subscription_fk` FOREIGN KEY (`subscription_id`) REFERENCES `billing_subscriptions` (`subscription_id`),
  CONSTRAINT `billing_invoices_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 64)),
  CONSTRAINT `billing_invoices_status_check` CHECK ((`status` in (_utf8mb4'DRAFT',_utf8mb4'OPEN',_utf8mb4'PAID',_utf8mb4'VOID',_utf8mb4'UNCOLLECTIBLE'))),
  CONSTRAINT `billing_invoices_total_check` CHECK ((`total_amount_minor` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_payment_attempts
CREATE TABLE `billing_payment_attempts` (
  `payment_attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `invoice_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `increase_request_ref` varchar(64) COLLATE utf8mb4_bin DEFAULT NULL,
  `payment_method_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `quote_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `price_book_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `price_book_version` int unsigned DEFAULT NULL,
  `target_device_limit` int unsigned DEFAULT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `provider_reference` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`payment_attempt_id`),
  KEY `billing_payment_attempts_account_ref_idx` (`account_ref`),
  KEY `billing_payment_attempts_invoice_id_idx` (`invoice_id`),
  KEY `billing_payment_attempts_increase_request_ref_idx` (`increase_request_ref`),
  KEY `billing_payment_attempts_payment_method_fk` (`payment_method_id`),
  KEY `billing_payment_attempts_quote_fk` (`quote_id`),
  KEY `billing_payment_attempts_price_book_fk` (`price_book_id`),
  KEY `billing_payment_attempts_currency_fk` (`currency_code`),
  CONSTRAINT `billing_payment_attempts_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_payment_attempts_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`invoice_id`),
  CONSTRAINT `billing_payment_attempts_payment_method_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `billing_payment_methods` (`payment_method_id`),
  CONSTRAINT `billing_payment_attempts_price_book_fk` FOREIGN KEY (`price_book_id`) REFERENCES `billing_price_books` (`price_book_id`),
  CONSTRAINT `billing_payment_attempts_quote_fk` FOREIGN KEY (`quote_id`) REFERENCES `billing_quotes` (`quote_id`),
  CONSTRAINT `billing_payment_attempts_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 64)),
  CONSTRAINT `billing_payment_attempts_amount_check` CHECK ((`amount_minor` >= 0)),
  CONSTRAINT `billing_payment_attempts_increase_request_ref_check` CHECK (((`increase_request_ref` is null) or (char_length(`increase_request_ref`) between 1 and 64))),
  CONSTRAINT `billing_payment_attempts_status_check` CHECK ((`status` in (_utf8mb4'CREATED',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'FAILED',_utf8mb4'CANCELLED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_payment_methods
CREATE TABLE `billing_payment_methods` (
  `payment_method_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `provider_payment_method_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `brand` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `display_label` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `last4` char(4) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `expiry_month` tinyint unsigned DEFAULT NULL,
  `expiry_year` smallint unsigned DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`payment_method_id`),
  KEY `billing_payment_methods_account_ref_idx` (`account_ref`),
  CONSTRAINT `billing_payment_methods_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 64)),
  CONSTRAINT `billing_payment_methods_expiry_month_check` CHECK (((`expiry_month` is null) or (`expiry_month` between 1 and 12))),
  CONSTRAINT `billing_payment_methods_last4_check` CHECK (((`last4` is null) or regexp_like(`last4`,_utf8mb4'^[0-9]{4}$'))),
  CONSTRAINT `billing_payment_methods_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REMOVED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_payment_transactions
CREATE TABLE `billing_payment_transactions` (
  `payment_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_attempt_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `invoice_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `provider_transaction_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `quote_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `price_book_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `price_book_version` int unsigned DEFAULT NULL,
  `confirmed_at` datetime(3) NOT NULL,
  PRIMARY KEY (`payment_transaction_id`),
  UNIQUE KEY `billing_payment_transactions_attempt_key` (`payment_attempt_id`),
  KEY `billing_payment_transactions_account_ref_idx` (`account_ref`),
  KEY `billing_payment_transactions_invoice_fk` (`invoice_id`),
  KEY `billing_payment_transactions_currency_fk` (`currency_code`),
  KEY `billing_payment_transactions_quote_fk` (`quote_id`),
  KEY `billing_payment_transactions_price_book_fk` (`price_book_id`),
  CONSTRAINT `billing_payment_transactions_attempt_fk` FOREIGN KEY (`payment_attempt_id`) REFERENCES `billing_payment_attempts` (`payment_attempt_id`),
  CONSTRAINT `billing_payment_transactions_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_payment_transactions_invoice_fk` FOREIGN KEY (`invoice_id`) REFERENCES `billing_invoices` (`invoice_id`),
  CONSTRAINT `billing_payment_transactions_price_book_fk` FOREIGN KEY (`price_book_id`) REFERENCES `billing_price_books` (`price_book_id`),
  CONSTRAINT `billing_payment_transactions_quote_fk` FOREIGN KEY (`quote_id`) REFERENCES `billing_quotes` (`quote_id`),
  CONSTRAINT `billing_payment_transactions_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 64)),
  CONSTRAINT `billing_payment_transactions_amount_check` CHECK ((`amount_minor` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_plans
CREATE TABLE `billing_plans` (
  `plan_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `plan_code` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `plan_version` int unsigned NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `billing_cadence` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `default_parent_member_limit` int unsigned NOT NULL,
  `default_managed_device_limit` int unsigned NOT NULL,
  `price_book_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`plan_id`),
  UNIQUE KEY `billing_plans_code_version` (`plan_code`,`plan_version`),
  KEY `billing_plans_price_book_fk` (`price_book_id`),
  CONSTRAINT `billing_plans_price_book_fk` FOREIGN KEY (`price_book_id`) REFERENCES `billing_price_books` (`price_book_id`),
  CONSTRAINT `billing_plans_cadence_check` CHECK ((`billing_cadence` in (_utf8mb4'MONTHLY',_utf8mb4'ANNUAL',_utf8mb4'ONE_TIME',_utf8mb4'FREE'))),
  CONSTRAINT `billing_plans_plan_code_check` CHECK ((char_length(`plan_code`) between 1 and 64)),
  CONSTRAINT `billing_plans_status_check` CHECK ((`status` in (_utf8mb4'DRAFT',_utf8mb4'ACTIVE',_utf8mb4'RETIRED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_price_books
CREATE TABLE `billing_price_books` (
  `price_book_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `commercial_market` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_device_limit` int unsigned NOT NULL,
  `amount_minor` bigint NOT NULL,
  `price_book_version` int unsigned NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `effective_from` datetime(3) NOT NULL,
  `effective_to` datetime(3) DEFAULT NULL,
  `created_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `open_active_key` varchar(64) COLLATE utf8mb4_bin GENERATED ALWAYS AS ((case when ((`status` = _utf8mb4'ACTIVE') and (`effective_to` is null)) then concat(`commercial_market`,_ascii'|',`currency_code`,_ascii'|',`target_device_limit`) else NULL end)) STORED,
  PRIMARY KEY (`price_book_id`),
  UNIQUE KEY `billing_price_books_key_version` (`commercial_market`,`currency_code`,`target_device_limit`,`price_book_version`),
  UNIQUE KEY `billing_price_books_open_active_key` (`open_active_key`),
  KEY `billing_price_books_lookup_idx` (`commercial_market`,`currency_code`,`target_device_limit`,`effective_from`),
  KEY `billing_price_books_currency_fk` (`currency_code`),
  KEY `billing_price_books_admin_fk` (`created_by_admin_id`),
  CONSTRAINT `billing_price_books_admin_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `billing_price_books_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_price_books_market_fk` FOREIGN KEY (`commercial_market`) REFERENCES `billing_commercial_markets` (`commercial_market`),
  CONSTRAINT `billing_price_books_amount_check` CHECK ((`amount_minor` >= 0)),
  CONSTRAINT `billing_price_books_period_check` CHECK (((`effective_to` is null) or (`effective_to` >= `effective_from`))),
  CONSTRAINT `billing_price_books_status_check` CHECK ((`status` in (_utf8mb4'DRAFT',_utf8mb4'ACTIVE',_utf8mb4'RETIRED'))),
  CONSTRAINT `billing_price_books_target_check` CHECK ((`target_device_limit` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_provider_events
CREATE TABLE `billing_provider_events` (
  `provider_event_row_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `provider_event_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `received_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `processing_status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `correlation_ref` varchar(64) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`provider_event_row_id`),
  UNIQUE KEY `billing_provider_events_provider_event_key` (`provider`,`provider_event_id`),
  CONSTRAINT `billing_provider_events_status_check` CHECK ((`processing_status` in (_utf8mb4'RECEIVED',_utf8mb4'PROCESSED',_utf8mb4'IGNORED',_utf8mb4'FAILED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_quotes
CREATE TABLE `billing_quotes` (
  `quote_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `increase_request_ref` varchar(64) COLLATE utf8mb4_bin DEFAULT NULL,
  `commercial_market` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `target_device_limit` int unsigned NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  PRIMARY KEY (`quote_id`),
  KEY `billing_quotes_increase_request_ref_idx` (`increase_request_ref`),
  KEY `billing_quotes_market_fk` (`commercial_market`),
  KEY `billing_quotes_currency_fk` (`currency_code`),
  KEY `billing_quotes_admin_fk` (`issued_by_admin_id`),
  CONSTRAINT `billing_quotes_admin_fk` FOREIGN KEY (`issued_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `billing_quotes_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_quotes_market_fk` FOREIGN KEY (`commercial_market`) REFERENCES `billing_commercial_markets` (`commercial_market`),
  CONSTRAINT `billing_quotes_amount_check` CHECK ((`amount_minor` >= 0)),
  CONSTRAINT `billing_quotes_expiry_check` CHECK ((`expires_at` > `issued_at`)),
  CONSTRAINT `billing_quotes_increase_request_ref_check` CHECK (((`increase_request_ref` is null) or (char_length(`increase_request_ref`) between 1 and 64))),
  CONSTRAINT `billing_quotes_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'CONSUMED',_utf8mb4'EXPIRED',_utf8mb4'SUPERSEDED'))),
  CONSTRAINT `billing_quotes_target_check` CHECK ((`target_device_limit` >= 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_refund_operations
CREATE TABLE `billing_refund_operations` (
  `refund_operation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_code` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `reason_note` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `initiated_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `step_up_session_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `idempotency_key` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `provider_refund_ref` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `state` varchar(20) COLLATE utf8mb4_bin NOT NULL,
  `refund_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`refund_operation_id`),
  UNIQUE KEY `billing_refund_operations_idempotency_key` (`idempotency_key`),
  KEY `billing_refund_operations_transaction_idx` (`payment_transaction_id`),
  KEY `billing_refund_operations_currency_fk` (`currency_code`),
  KEY `billing_refund_operations_admin_fk` (`initiated_by_admin_id`),
  KEY `billing_refund_operations_step_up_fk` (`step_up_session_id`),
  KEY `billing_refund_operations_refund_fk` (`refund_id`),
  CONSTRAINT `billing_refund_operations_admin_fk` FOREIGN KEY (`initiated_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `billing_refund_operations_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_refund_operations_refund_fk` FOREIGN KEY (`refund_id`) REFERENCES `billing_refunds` (`refund_id`),
  CONSTRAINT `billing_refund_operations_step_up_fk` FOREIGN KEY (`step_up_session_id`) REFERENCES `platform_admin_step_up_sessions` (`step_up_id`),
  CONSTRAINT `billing_refund_operations_transaction_fk` FOREIGN KEY (`payment_transaction_id`) REFERENCES `billing_payment_transactions` (`payment_transaction_id`),
  CONSTRAINT `billing_refund_operations_amount_check` CHECK ((`amount_minor` > 0)),
  CONSTRAINT `billing_refund_operations_reason_note_check` CHECK (((`reason_note` is null) or (char_length(`reason_note`) <= 255))),
  CONSTRAINT `billing_refund_operations_state_check` CHECK ((`state` in (_utf8mb4'CREATED',_utf8mb4'PROVIDER_CONFIRMED',_utf8mb4'FINALIZED',_utf8mb4'FAILED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_refunds
CREATE TABLE `billing_refunds` (
  `refund_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `reason_code` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `reason_note` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `initiated_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `step_up_session_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `entitlement_treatment` varchar(32) COLLATE utf8mb4_bin NOT NULL DEFAULT 'NOT_APPLICABLE',
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`refund_id`),
  KEY `billing_refunds_transaction_idx` (`payment_transaction_id`),
  KEY `billing_refunds_currency_fk` (`currency_code`),
  KEY `billing_refunds_admin_fk` (`initiated_by_admin_id`),
  KEY `billing_refunds_step_up_fk` (`step_up_session_id`),
  CONSTRAINT `billing_refunds_admin_fk` FOREIGN KEY (`initiated_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `billing_refunds_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `billing_refunds_step_up_fk` FOREIGN KEY (`step_up_session_id`) REFERENCES `platform_admin_step_up_sessions` (`step_up_id`),
  CONSTRAINT `billing_refunds_transaction_fk` FOREIGN KEY (`payment_transaction_id`) REFERENCES `billing_payment_transactions` (`payment_transaction_id`),
  CONSTRAINT `billing_refunds_amount_check` CHECK ((`amount_minor` > 0)),
  CONSTRAINT `billing_refunds_entitlement_treatment_check` CHECK ((`entitlement_treatment` in (_utf8mb4'NOT_APPLICABLE',_utf8mb4'ENTITLEMENT_UNCHANGED',_utf8mb4'ENTITLEMENT_REDUCTION_PENDING'))),
  CONSTRAINT `billing_refunds_reason_note_check` CHECK (((`reason_note` is null) or (char_length(`reason_note`) <= 255))),
  CONSTRAINT `billing_refunds_status_check` CHECK ((`status` in (_utf8mb4'RECORDED',_utf8mb4'FAILED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- billing_subscriptions
CREATE TABLE `billing_subscriptions` (
  `subscription_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `plan_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `current_period_start` datetime(3) NOT NULL,
  `current_period_end` datetime(3) NOT NULL,
  `payment_method_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `canceled_at` datetime(3) DEFAULT NULL,
  `auto_renew` tinyint(1) NOT NULL DEFAULT '1',
  `active_account_key` varchar(80) COLLATE utf8mb4_bin GENERATED ALWAYS AS ((case when (`status` in (_utf8mb4'TRIALING',_utf8mb4'ACTIVE',_utf8mb4'PAST_DUE')) then `account_ref` else NULL end)) STORED,
  PRIMARY KEY (`subscription_id`),
  UNIQUE KEY `billing_subscriptions_active_account_key` (`active_account_key`),
  KEY `billing_subscriptions_account_ref_idx` (`account_ref`),
  KEY `billing_subscriptions_plan_fk` (`plan_id`),
  KEY `billing_subscriptions_payment_method_fk` (`payment_method_id`),
  CONSTRAINT `billing_subscriptions_payment_method_fk` FOREIGN KEY (`payment_method_id`) REFERENCES `billing_payment_methods` (`payment_method_id`),
  CONSTRAINT `billing_subscriptions_plan_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans` (`plan_id`),
  CONSTRAINT `billing_subscriptions_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 64)),
  CONSTRAINT `billing_subscriptions_status_check` CHECK ((`status` in (_utf8mb4'TRIALING',_utf8mb4'ACTIVE',_utf8mb4'PAST_DUE',_utf8mb4'CANCELED',_utf8mb4'EXPIRED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- commercial_notifications
CREATE TABLE `commercial_notifications` (
  `notification_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `event_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `dedupe_key` varchar(191) COLLATE utf8mb4_bin NOT NULL,
  `resource_ref` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `message_key` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `params_json` json DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `read_at` datetime(3) DEFAULT NULL,
  `acknowledged_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`notification_id`),
  UNIQUE KEY `commercial_notifications_dedupe_key` (`dedupe_key`),
  KEY `commercial_notifications_account_created_idx` (`account_ref`,`created_at`),
  KEY `commercial_notifications_account_unread_idx` (`account_ref`,`read_at`),
  CONSTRAINT `commercial_notifications_account_ref_check` CHECK ((char_length(`account_ref`) between 1 and 128)),
  CONSTRAINT `commercial_notifications_acknowledged_after_read_check` CHECK (((`acknowledged_at` is null) or (`read_at` is not null))),
  CONSTRAINT `commercial_notifications_dedupe_key_check` CHECK ((char_length(`dedupe_key`) between 1 and 191)),
  CONSTRAINT `commercial_notifications_event_type_check` CHECK ((`event_type` in (_utf8mb4'QUOTE_READY',_utf8mb4'PAYMENT_CONFIRMED',_utf8mb4'ENTITLEMENT_INCREASED',_utf8mb4'PAYMENT_FAILED',_utf8mb4'REQUEST_DENIED',_utf8mb4'QUOTE_EXPIRED',_utf8mb4'RENEWAL_UPCOMING'))),
  CONSTRAINT `commercial_notifications_message_key_check` CHECK ((char_length(`message_key`) between 1 and 64)),
  CONSTRAINT `commercial_notifications_resource_ref_check` CHECK (((`resource_ref` is null) or (char_length(`resource_ref`) between 1 and 128)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- complimentary_entitlement_grants
CREATE TABLE `complimentary_entitlement_grants` (
  `grant_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `entitlement_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `category` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `amount_or_allowance` int NOT NULL,
  `effective_from` datetime(3) NOT NULL,
  `expires_at` datetime(3) DEFAULT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACTIVE',
  `reason_code` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `internal_note` varchar(2000) COLLATE utf8mb4_bin DEFAULT NULL,
  `granted_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revoked_at` datetime(3) DEFAULT NULL,
  `revoked_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `revision` bigint NOT NULL DEFAULT '0',
  PRIMARY KEY (`grant_id`),
  KEY `complimentary_entitlement_grants_family_scope_idx` (`family_id`,`entitlement_type`,`status`),
  KEY `complimentary_entitlement_grants_expiry_idx` (`status`,`expires_at`),
  KEY `complimentary_entitlement_grants_granted_by_idx` (`granted_by_admin_id`),
  KEY `complimentary_entitlement_grants_revoked_by_fk` (`revoked_by_admin_id`),
  CONSTRAINT `complimentary_entitlement_grants_granted_by_fk` FOREIGN KEY (`granted_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `complimentary_entitlement_grants_revoked_by_fk` FOREIGN KEY (`revoked_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `complimentary_entitlement_grants_amount_check` CHECK ((`amount_or_allowance` >= 0)),
  CONSTRAINT `complimentary_entitlement_grants_category_check` CHECK ((`category` in (_utf8mb4'FOUNDER',_utf8mb4'STAFF',_utf8mb4'STAFF_FAMILY',_utf8mb4'BETA_TESTER',_utf8mb4'PARTNER',_utf8mb4'PROMOTION',_utf8mb4'SUPPORT_EXCEPTION',_utf8mb4'LIFETIME_COMPLIMENTARY',_utf8mb4'TEMPORARY_COMPLIMENTARY',_utf8mb4'OTHER'))),
  CONSTRAINT `complimentary_entitlement_grants_entitlement_type_check` CHECK ((`entitlement_type` in (_utf8mb4'COMMERCIAL_ACCESS',_utf8mb4'MANAGED_DEVICE_CAPACITY',_utf8mb4'PARENT_MEMBER_CAPACITY'))),
  CONSTRAINT `complimentary_entitlement_grants_expiry_order_check` CHECK (((`expires_at` is null) or (`expires_at` > `effective_from`))),
  CONSTRAINT `complimentary_entitlement_grants_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `complimentary_entitlement_grants_internal_note_check` CHECK (((`internal_note` is null) or (char_length(`internal_note`) <= 2000))),
  CONSTRAINT `complimentary_entitlement_grants_reason_code_check` CHECK ((char_length(`reason_code`) between 1 and 64)),
  CONSTRAINT `complimentary_entitlement_grants_revoked_pair_check` CHECK (((`status` <> _utf8mb4'REVOKED') or ((`revoked_at` is not null) and (`revoked_by_admin_id` is not null)))),
  CONSTRAINT `complimentary_entitlement_grants_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED',_utf8mb4'EXPIRED')))
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

-- device_protection_status
CREATE TABLE `device_protection_status` (
  `device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `protection_level` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`device_id`),
  KEY `device_protection_status_family_id_idx` (`family_id`),
  CONSTRAINT `device_protection_status_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`),
  CONSTRAINT `device_protection_status_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `device_protection_status_level_check` CHECK ((`protection_level` in (_utf8mb4'STANDARD',_utf8mb4'PROTECTED',_utf8mb4'DEGRADED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'NOT_SUPPORTED')))
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
  `registered_by_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`device_id`),
  KEY `devices_family_id_idx` (`family_id`),
  KEY `devices_paired_by_account_id_fk` (`paired_by_account_id`),
  KEY `devices_registered_by_account_id_fk` (`registered_by_account_id`),
  CONSTRAINT `devices_paired_by_account_id_fk` FOREIGN KEY (`paired_by_account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `devices_registered_by_account_id_fk` FOREIGN KEY (`registered_by_account_id`) REFERENCES `service_accounts` (`account_id`),
  CONSTRAINT `devices_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `devices_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS',_utf8mb4'BROWSER'))),
  CONSTRAINT `devices_status_check` CHECK ((`status` in (_utf8mb4'PAIRING_PENDING',_utf8mb4'PAIRED',_utf8mb4'ACTIVE',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- enrollment_administration_verifiers
CREATE TABLE `enrollment_administration_verifiers` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `salt_b64` varchar(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `verifier_b64` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `failed_attempts` tinyint unsigned NOT NULL DEFAULT '0',
  `locked_until` datetime(3) DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`),
  CONSTRAINT `enrollment_administration_verifiers_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_administration_verifiers_salt_check` CHECK ((char_length(`salt_b64`) between 1 and 32)),
  CONSTRAINT `enrollment_administration_verifiers_verifier_check` CHECK ((char_length(`verifier_b64`) between 1 and 64))
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
  KEY `enrollment_bootstrap_attempts_invitation_id_idx` (`invitation_id`),
  CONSTRAINT `enrollment_bootstrap_attempts_device_id_fk` FOREIGN KEY (`device_id`) REFERENCES `devices` (`device_id`),
  CONSTRAINT `enrollment_bootstrap_attempts_invitation_id_fk` FOREIGN KEY (`invitation_id`) REFERENCES `enrollment_invitations` (`invitation_id`),
  CONSTRAINT `enrollment_bootstrap_attempts_attempt_id_check` CHECK ((char_length(`attempt_id`) between 16 and 64)),
  CONSTRAINT `enrollment_bootstrap_attempts_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_bootstrap_attempts_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))),
  CONSTRAINT `enrollment_bootstrap_attempts_recovery_token_hash_check` CHECK (regexp_like(`recovery_token_hash`,_ascii'^[0-9a-f]{64}$')),
  CONSTRAINT `enrollment_bootstrap_attempts_status_check` CHECK ((`status` = _utf8mb4'COMPLETED')),
  CONSTRAINT `enrollment_bootstrap_attempts_token_hash_check` CHECK (regexp_like(`token_hash`,_ascii'^[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- enrollment_invitation_transitions
CREATE TABLE `enrollment_invitation_transitions` (
  `transition_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `from_status` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `to_status` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `transitioned_at` datetime(3) NOT NULL,
  PRIMARY KEY (`transition_id`),
  KEY `enrollment_invitation_transitions_invitation_idx` (`invitation_id`,`transitioned_at`),
  CONSTRAINT `enrollment_invitation_transitions_invitation_fk` FOREIGN KEY (`invitation_id`) REFERENCES `enrollment_invitations` (`invitation_id`),
  CONSTRAINT `enrollment_invitation_transitions_from_status_check` CHECK ((`from_status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))),
  CONSTRAINT `enrollment_invitation_transitions_to_status_check` CHECK ((`to_status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- enrollment_invitations
CREATE TABLE `enrollment_invitations` (
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `child_profile_id` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `token_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `platform` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `requested_protection_mode` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `age_ux_tier` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'YOUNG_CHILD',
  `initial_policy_profile` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'BALANCED',
  `status` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `opened_at` datetime(3) DEFAULT NULL,
  `install_required_at` datetime(3) DEFAULT NULL,
  `app_installed_at` datetime(3) DEFAULT NULL,
  `authorization_required_at` datetime(3) DEFAULT NULL,
  `redeemed_at` datetime(3) DEFAULT NULL,
  `expired_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`invitation_id`),
  UNIQUE KEY `enrollment_invitations_token_hash_key` (`token_hash`),
  KEY `enrollment_invitations_family_id_idx` (`family_id`),
  KEY `enrollment_invitations_family_child_idx` (`family_id`,`child_profile_id`),
  CONSTRAINT `enrollment_invitations_age_ux_tier_check` CHECK ((`age_ux_tier` in (_utf8mb4'YOUNG_CHILD',_utf8mb4'TEEN'))),
  CONSTRAINT `enrollment_invitations_child_profile_id_check` CHECK (((`child_profile_id` is null) or regexp_like(`child_profile_id`,_utf8mb4'^[A-Za-z0-9_-]{1,128}$'))),
  CONSTRAINT `enrollment_invitations_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_invitations_initial_policy_profile_check` CHECK ((`initial_policy_profile` in (_utf8mb4'BALANCED',_utf8mb4'STRICT'))),
  CONSTRAINT `enrollment_invitations_platform_check` CHECK ((`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))),
  CONSTRAINT `enrollment_invitations_protection_mode_check` CHECK ((`requested_protection_mode` in (_utf8mb4'ANDROID_STANDARD',_utf8mb4'ANDROID_PROTECTED',_utf8mb4'IOS_STANDARD'))),
  CONSTRAINT `enrollment_invitations_status_check` CHECK ((`status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))),
  CONSTRAINT `enrollment_invitations_token_hash_check` CHECK (regexp_like(`token_hash`,_ascii'^[0-9a-f]{64}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- enrollment_protection_approval_requests
CREATE TABLE `enrollment_protection_approval_requests` (
  `request_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `child_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `device_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `operation` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `protection_level` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `requested_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `reason_category` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `protective_authority_applies` tinyint unsigned NOT NULL,
  `state` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `decided_at` datetime(3) DEFAULT NULL,
  `decision_method` varchar(32) COLLATE utf8mb4_bin DEFAULT NULL,
  `temporary_disable_until` datetime(3) DEFAULT NULL,
  `decided_by_device_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `decision_action_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `idempotency_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `decision_fingerprint` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  UNIQUE KEY `enrollment_protection_approval_decision_action_uq` (`decision_action_id`),
  KEY `enrollment_protection_approval_family_state_idx` (`family_id`,`state`,`expires_at`),
  CONSTRAINT `enrollment_protection_approval_authority_check` CHECK ((`protective_authority_applies` = 1)),
  CONSTRAINT `enrollment_protection_approval_child_id_check` CHECK ((char_length(`child_id`) between 1 and 200)),
  CONSTRAINT `enrollment_protection_approval_decided_device_check` CHECK (((`decided_by_device_id` is null) or (char_length(`decided_by_device_id`) between 1 and 200))),
  CONSTRAINT `enrollment_protection_approval_decision_action_check` CHECK (((`decision_action_id` is null) or (char_length(`decision_action_id`) between 1 and 128))),
  CONSTRAINT `enrollment_protection_approval_device_id_check` CHECK ((char_length(`device_id`) between 1 and 200)),
  CONSTRAINT `enrollment_protection_approval_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `enrollment_protection_approval_fingerprint_check` CHECK (((`decision_fingerprint` is null) or (char_length(`decision_fingerprint`) = 64))),
  CONSTRAINT `enrollment_protection_approval_idempotency_check` CHECK (((`idempotency_key` is null) or (char_length(`idempotency_key`) between 1 and 128))),
  CONSTRAINT `enrollment_protection_approval_level_check` CHECK ((`protection_level` in (_utf8mb4'STANDARD',_utf8mb4'PROTECTED',_utf8mb4'DEGRADED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'NOT_SUPPORTED'))),
  CONSTRAINT `enrollment_protection_approval_method_check` CHECK (((`decision_method` is null) or (`decision_method` in (_utf8mb4'REMOTE_PARENT',_utf8mb4'LOCAL_ADMINISTRATION_PIN',_utf8mb4'AUTHORIZED_RECOVERY')))),
  CONSTRAINT `enrollment_protection_approval_operation_check` CHECK ((`operation` in (_utf8mb4'REMOVE_REVOKE_DEVICE',_utf8mb4'DISABLE_PROTECTION_POLICY'))),
  CONSTRAINT `enrollment_protection_approval_reason_check` CHECK (((`reason_category` is null) or (`reason_category` in (_utf8mb4'ROUTINE_POLICY_CHANGE',_utf8mb4'CHILD_SAFETY_CONCERN',_utf8mb4'DEVICE_LOST_OR_STOLEN',_utf8mb4'FAMILY_MEMBERSHIP_CHANGE',_utf8mb4'RECOVERY',_utf8mb4'OTHER')))),
  CONSTRAINT `enrollment_protection_approval_state_check` CHECK ((`state` in (_utf8mb4'PARENT_APPROVAL_REQUIRED',_utf8mb4'KEEP_ACTIVE',_utf8mb4'TEMPORARILY_DISABLE',_utf8mb4'ALLOW_REMOVAL'))),
  CONSTRAINT `enrollment_protection_approval_window_check` CHECK ((`expires_at` > `requested_at`))
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

-- eye_protection_settings
CREATE TABLE `eye_protection_settings` (
  `child_profile_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `reminders_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`child_profile_id`),
  KEY `eye_protection_settings_family_idx` (`family_id`),
  CONSTRAINT `eye_protection_settings_reminders_enabled_check` CHECK ((`reminders_enabled` in (0,1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- families
CREATE TABLE `families` (
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_reference_hash` varbinary(255) NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACTIVE',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `deleted_at` datetime(3) DEFAULT NULL,
  `suspended_at` datetime(3) DEFAULT NULL,
  `suspended_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `suspension_reason` varchar(500) COLLATE utf8mb4_bin DEFAULT NULL,
  PRIMARY KEY (`family_id`),
  UNIQUE KEY `families_family_reference_hash_key` (`family_reference_hash`),
  KEY `families_suspended_by_fk` (`suspended_by_admin_id`),
  KEY `families_status_idx` (`status`),
  CONSTRAINT `families_suspended_by_fk` FOREIGN KEY (`suspended_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `families_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'SUSPENDED'))),
  CONSTRAINT `families_suspension_pair_check` CHECK ((((`status` = _utf8mb4'SUSPENDED') and (`suspended_at` is not null) and (`suspended_by_admin_id` is not null) and (`suspension_reason` is not null)) or ((`status` = _utf8mb4'ACTIVE') and (`suspended_at` is null) and (`suspended_by_admin_id` is null) and (`suspension_reason` is null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_audit_events
CREATE TABLE `family_audit_events` (
  `envelope_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `parent_device_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `key_epoch` int unsigned NOT NULL,
  `generated_at_utc` datetime(3) NOT NULL,
  `encrypted_payload_b64` mediumtext CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nonce_b64` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
  PRIMARY KEY (`envelope_id`),
  KEY `family_audit_events_family_idx` (`family_id`,`generated_at_utc`),
  KEY `family_audit_events_parent_device_idx` (`family_id`,`parent_device_id`,`generated_at_utc`),
  KEY `family_audit_events_expires_at_idx` (`expires_at`),
  CONSTRAINT `family_audit_events_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `family_audit_events_key_epoch_check` CHECK ((`key_epoch` >= 0)),
  CONSTRAINT `family_audit_events_nonce_check` CHECK ((char_length(`nonce_b64`) between 1 and 64)),
  CONSTRAINT `family_audit_events_parent_device_id_check` CHECK ((char_length(`parent_device_id`) between 1 and 200)),
  CONSTRAINT `family_audit_events_payload_check` CHECK ((char_length(`encrypted_payload_b64`) between 1 and 4194304))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_authority_attestations
CREATE TABLE `family_authority_attestations` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `attestation_id` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `attestation_revision` int unsigned NOT NULL,
  `owner_device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_dsk_key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `owner_dsk_public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `trust_set_epoch` int unsigned NOT NULL,
  `key_epoch` int unsigned NOT NULL,
  `issued_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `previous_attestation_id` char(64) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `signer_device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `signer_dsk_key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `signer_dsk_public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `signature` varchar(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`family_id`,`attestation_id`),
  UNIQUE KEY `family_authority_attestations_family_revision_key` (`family_id`,`attestation_revision`),
  CONSTRAINT `family_authority_attestations_genesis_fk` FOREIGN KEY (`family_id`) REFERENCES `family_authority_genesis_anchors` (`family_id`),
  CONSTRAINT `family_authority_attestations_revision_check` CHECK ((`attestation_revision` >= 1)),
  CONSTRAINT `family_authority_attestations_ttl_check` CHECK ((`expires_at` > `issued_at`))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_authority_chain_heads
CREATE TABLE `family_authority_chain_heads` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `head_attestation_id` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `head_revision` int unsigned NOT NULL,
  `status` varchar(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`),
  KEY `family_authority_chain_heads_attestation_fk` (`family_id`,`head_attestation_id`),
  CONSTRAINT `family_authority_chain_heads_attestation_fk` FOREIGN KEY (`family_id`, `head_attestation_id`) REFERENCES `family_authority_attestations` (`family_id`, `attestation_id`),
  CONSTRAINT `family_authority_chain_heads_genesis_fk` FOREIGN KEY (`family_id`) REFERENCES `family_authority_genesis_anchors` (`family_id`),
  CONSTRAINT `family_authority_chain_heads_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_authority_genesis_anchors
CREATE TABLE `family_authority_genesis_anchors` (
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `genesis_device_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `genesis_dsk_key_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `genesis_dsk_public_key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `protocol_version` smallint unsigned NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `signature` varchar(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`family_id`),
  CONSTRAINT `family_authority_genesis_anchors_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `family_authority_genesis_anchors_protocol_version_check` CHECK ((`protocol_version` between 1 and 100))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_child_memberships
CREATE TABLE `family_child_memberships` (
  `child_profile_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `creation_request_key` varchar(191) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`child_profile_id`),
  UNIQUE KEY `family_child_memberships_family_creation_key` (`family_id`,`creation_request_key`),
  KEY `family_child_memberships_family_id_idx` (`family_id`),
  CONSTRAINT `family_child_memberships_child_profile_id_check` CHECK (regexp_like(`child_profile_id`,_utf8mb4'^[A-Za-z0-9_-]{1,128}$')),
  CONSTRAINT `family_child_memberships_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_member_invitations
CREATE TABLE `family_member_invitations` (
  `invitation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `invited_email_hash` binary(32) NOT NULL,
  `role` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL,
  `invited_by_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL,
  `expires_at` datetime(3) NOT NULL,
  `accepted_at` datetime(3) DEFAULT NULL,
  `expired_at` datetime(3) DEFAULT NULL,
  `revoked_at` datetime(3) DEFAULT NULL,
  `accepted_by_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `pending_invited_email_hash` binary(32) GENERATED ALWAYS AS ((case when (`status` = _utf8mb4'PENDING') then `invited_email_hash` else NULL end)) STORED,
  PRIMARY KEY (`invitation_id`),
  UNIQUE KEY `family_member_invitations_pending_email_key` (`family_id`,`pending_invited_email_hash`),
  KEY `family_member_invitations_family_id_idx` (`family_id`),
  KEY `family_member_invitations_email_hash_idx` (`invited_email_hash`),
  CONSTRAINT `family_member_invitations_role_check` CHECK ((`role` in (_utf8mb4'ADMINISTRATOR',_utf8mb4'VIEWER'))),
  CONSTRAINT `family_member_invitations_status_check` CHECK ((`status` in (_utf8mb4'PENDING',_utf8mb4'ACCEPTED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- family_rbac_policy_config
CREATE TABLE `family_rbac_policy_config` (
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `administrator_can_manage_viewers` tinyint(1) NOT NULL DEFAULT '0',
  `administrator_can_revoke_device_or_disable_protection` tinyint(1) NOT NULL DEFAULT '0',
  `updated_at` datetime(3) NOT NULL,
  PRIMARY KEY (`family_id`)
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

-- parent_account_preferences
CREATE TABLE `parent_account_preferences` (
  `account_id` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `language_code` varchar(2) COLLATE utf8mb4_bin NOT NULL DEFAULT 'en',
  `email_alerts_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `push_requests_enabled` tinyint(1) NOT NULL DEFAULT '1',
  `email_destination` varchar(320) COLLATE utf8mb4_bin DEFAULT NULL,
  `email_destination_state` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'UNVERIFIED',
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`account_id`),
  CONSTRAINT `parent_account_preferences_email_check` CHECK ((`email_alerts_enabled` in (0,1))),
  CONSTRAINT `parent_account_preferences_email_state_check` CHECK ((`email_destination_state` in (_utf8mb4'UNVERIFIED',_utf8mb4'VERIFIED'))),
  CONSTRAINT `parent_account_preferences_language_check` CHECK ((`language_code` in (_utf8mb4'en',_utf8mb4'ar'))),
  CONSTRAINT `parent_account_preferences_push_check` CHECK ((`push_requests_enabled` in (0,1)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- parent_accounts
CREATE TABLE `parent_accounts` (
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `email_hash` binary(32) NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_bin NOT NULL,
  `status` varchar(24) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDING_VERIFICATION',
  `family_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `service_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `free_access_mode` varchar(16) COLLATE utf8mb4_bin DEFAULT NULL,
  `free_access_duration_days` int DEFAULT NULL,
  `free_access_started_at` datetime(3) DEFAULT NULL,
  `free_access_expires_at` datetime(3) DEFAULT NULL,
  `default_parent_member_limit` int DEFAULT NULL,
  `default_managed_device_limit` int DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `verified_at` datetime(3) DEFAULT NULL,
  `disabled_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`account_id`),
  UNIQUE KEY `parent_accounts_email_hash_key` (`email_hash`),
  UNIQUE KEY `parent_accounts_service_account_id_key` (`service_account_id`),
  CONSTRAINT `parent_accounts_free_access_mode_check` CHECK (((`free_access_mode` is null) or (`free_access_mode` in (_utf8mb4'TIME_LIMITED',_utf8mb4'PERPETUAL')))),
  CONSTRAINT `parent_accounts_status_check` CHECK ((`status` in (_utf8mb4'PENDING_VERIFICATION',_utf8mb4'VERIFIED'))),
  CONSTRAINT `parent_accounts_time_limited_has_duration_check` CHECK (((`free_access_mode` <> _utf8mb4'TIME_LIMITED') or (`free_access_duration_days` is not null))),
  CONSTRAINT `parent_accounts_verified_has_free_access_check` CHECK ((((`status` = _utf8mb4'PENDING_VERIFICATION') and (`verified_at` is null) and (`free_access_mode` is null)) or ((`status` = _utf8mb4'VERIFIED') and (`verified_at` is not null) and (`free_access_mode` is not null))))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- parent_email_verification_codes
CREATE TABLE `parent_email_verification_codes` (
  `code_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_bin DEFAULT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`code_id`),
  KEY `parent_email_verification_codes_account_idx` (`account_id`,`created_at`),
  CONSTRAINT `parent_email_verification_codes_account_fk` FOREIGN KEY (`account_id`) REFERENCES `parent_accounts` (`account_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- parent_password_reset_codes
CREATE TABLE `parent_password_reset_codes` (
  `code_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `code_hash` char(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expires_at` datetime(3) NOT NULL,
  `consumed_at` datetime(3) DEFAULT NULL,
  `attempt_count` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`code_id`),
  KEY `parent_password_reset_codes_account_idx` (`account_id`,`created_at`),
  CONSTRAINT `parent_password_reset_codes_account_fk` FOREIGN KEY (`account_id`) REFERENCES `parent_accounts` (`account_id`)
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
  CONSTRAINT `platform_admin_audit_events_event_type_check` CHECK ((`event_type` in (_utf8mb4'ADMIN_LOGIN',_utf8mb4'ADMIN_LOGIN_FAILED',_utf8mb4'ADMIN_CREATED',_utf8mb4'ADMIN_ROLE_CHANGED',_utf8mb4'ACCOUNT_SUSPENDED',_utf8mb4'ACCOUNT_REACTIVATED',_utf8mb4'DEVICE_LIMIT_CHANGED',_utf8mb4'LIMIT_REQUEST_APPROVED',_utf8mb4'LIMIT_REQUEST_DENIED',_utf8mb4'PLAN_CHANGED',_utf8mb4'PAYMENT_REFUNDED',_utf8mb4'BANK_SETTING_CHANGED',_utf8mb4'SETTING_CHANGED',_utf8mb4'PRICE_BOOK_CHANGED',_utf8mb4'QUOTE_ISSUED',_utf8mb4'PAYMENT_CONFIRMED',_utf8mb4'ENTITLEMENT_INCREASED',_utf8mb4'PAYMENT_ROLLED_BACK',_utf8mb4'ADMIN_SESSION_REVOKED',_utf8mb4'ADMIN_LOGIN_LOCKED_OUT',_utf8mb4'ADMIN_STEP_UP_GRANTED',_utf8mb4'ADMIN_STEP_UP_DENIED',_utf8mb4'ADMIN_MFA_ENROLLED',_utf8mb4'COMPLIMENTARY_GRANT_CREATED',_utf8mb4'COMPLIMENTARY_GRANT_CHANGED',_utf8mb4'COMPLIMENTARY_GRANT_REVOKED',_utf8mb4'COMPLIMENTARY_GRANT_EXPIRED',_utf8mb4'SETTLEMENT_ACCOUNT_CREATED',_utf8mb4'SETTLEMENT_ACCOUNT_CHANGED',_utf8mb4'SETTLEMENT_BATCH_CREATED',_utf8mb4'SETTLEMENT_BATCH_ITEM_ATTRIBUTED',_utf8mb4'SETTLEMENT_RECONCILIATION_RESOLVED'))),
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

-- platform_admin_security_alerts
CREATE TABLE `platform_admin_security_alerts` (
  `alert_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recipient_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `kind` varchar(20) COLLATE utf8mb4_bin NOT NULL,
  `occurred_at` datetime(3) NOT NULL,
  `correlation_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `delivery_state` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDING',
  `delivered_at` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`alert_id`),
  UNIQUE KEY `platform_admin_security_alerts_correlation_recipient_key` (`correlation_id`,`recipient_admin_id`),
  KEY `platform_admin_security_alerts_recipient_state_idx` (`recipient_admin_id`,`delivery_state`,`occurred_at`),
  KEY `platform_admin_security_alerts_source_fk` (`source_admin_id`),
  CONSTRAINT `platform_admin_security_alerts_recipient_fk` FOREIGN KEY (`recipient_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_security_alerts_source_fk` FOREIGN KEY (`source_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_security_alerts_delivery_state_check` CHECK ((`delivery_state` in (_utf8mb4'PENDING',_utf8mb4'DELIVERED'))),
  CONSTRAINT `platform_admin_security_alerts_delivery_timestamp_check` CHECK ((((`delivery_state` = _utf8mb4'PENDING') and (`delivered_at` is null)) or ((`delivery_state` = _utf8mb4'DELIVERED') and (`delivered_at` is not null)))),
  CONSTRAINT `platform_admin_security_alerts_kind_check` CHECK ((`kind` in (_utf8mb4'LOGIN_FAILED',_utf8mb4'LOCKED_OUT')))
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

-- platform_admin_settings
CREATE TABLE `platform_admin_settings` (
  `setting_key` varchar(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `category` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `value_json` text COLLATE utf8mb4_bin NOT NULL,
  `is_sensitive` tinyint(1) NOT NULL DEFAULT '0',
  `masked_display` varchar(128) COLLATE utf8mb4_bin DEFAULT NULL,
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `updated_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (`setting_key`),
  KEY `platform_admin_settings_category_idx` (`category`),
  KEY `platform_admin_settings_updated_by_fk` (`updated_by_admin_id`),
  CONSTRAINT `platform_admin_settings_updated_by_fk` FOREIGN KEY (`updated_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `platform_admin_settings_category_check` CHECK ((`category` in (_utf8mb4'BRANDING',_utf8mb4'PAYMENT_PROVIDER',_utf8mb4'NOTIFICATION',_utf8mb4'MAINTENANCE',_utf8mb4'FEATURE_FLAG'))),
  CONSTRAINT `platform_admin_settings_key_check` CHECK ((char_length(`setting_key`) between 1 and 128)),
  CONSTRAINT `platform_admin_settings_masked_display_check` CHECK ((((`is_sensitive` = 1) and (`masked_display` is not null) and (char_length(`masked_display`) between 1 and 128)) or ((`is_sensitive` = 0) and (`masked_display` is null))))
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
  CONSTRAINT `platform_admin_step_up_sessions_scope_check` CHECK ((`scope` in (_utf8mb4'REFUND',_utf8mb4'SETTLEMENT_BANK_CONFIG',_utf8mb4'ADMIN_ROLE_GRANT',_utf8mb4'FAMILY_ACCOUNT_SUSPEND',_utf8mb4'FAMILY_ACCOUNT_REACTIVATE',_utf8mb4'ENTITLEMENT_LIMIT_OVERRIDE',_utf8mb4'COMPLIMENTARY_GRANT_MUTATION')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- protection_alerts
CREATE TABLE `protection_alerts` (
  `alert_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `device_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL,
  `parent_device_id` varchar(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `trigger_type` varchar(32) COLLATE utf8mb4_bin NOT NULL,
  `key_epoch` int unsigned NOT NULL,
  `generated_at_utc` datetime(3) NOT NULL,
  `encrypted_payload_b64` mediumtext CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `nonce_b64` varchar(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `expires_at` datetime(3) NOT NULL DEFAULT '1970-01-01 00:00:00.000',
  PRIMARY KEY (`alert_id`),
  KEY `protection_alerts_family_idx` (`family_id`,`generated_at_utc`),
  KEY `protection_alerts_parent_device_idx` (`family_id`,`parent_device_id`,`generated_at_utc`),
  KEY `protection_alerts_expires_at_idx` (`expires_at`),
  CONSTRAINT `protection_alerts_device_id_check` CHECK (((`device_id` is null) or (char_length(`device_id`) between 1 and 200))),
  CONSTRAINT `protection_alerts_family_id_check` CHECK ((char_length(`family_id`) between 1 and 128)),
  CONSTRAINT `protection_alerts_key_epoch_check` CHECK ((`key_epoch` >= 0)),
  CONSTRAINT `protection_alerts_nonce_check` CHECK ((char_length(`nonce_b64`) between 1 and 64)),
  CONSTRAINT `protection_alerts_parent_device_id_check` CHECK ((char_length(`parent_device_id`) between 1 and 200)),
  CONSTRAINT `protection_alerts_payload_check` CHECK ((char_length(`encrypted_payload_b64`) between 1 and 4194304)),
  CONSTRAINT `protection_alerts_trigger_check` CHECK ((`trigger_type` in (_utf8mb4'DISABLE_OR_REMOVAL_REQUESTED',_utf8mb4'REPEATED_INVALID_PIN',_utf8mb4'AUTHORITY_CHANGE',_utf8mb4'CRITICAL_PERMISSION_OR_VPN_LOST',_utf8mb4'UNEXPECTED_OFFLINE',_utf8mb4'TIME_TAMPERING',_utf8mb4'PROTECTION_DEGRADED',_utf8mb4'REINSTALLATION',_utf8mb4'INVITATION_REDEEMED',_utf8mb4'UNENROLLMENT')))
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

-- safe_zones
CREATE TABLE `safe_zones` (
  `zone_id` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `family_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `recipient_endpoint_id` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `ciphertext` mediumblob NOT NULL,
  `nonce` varbinary(64) NOT NULL,
  `key_epoch` int unsigned NOT NULL,
  `revision` int unsigned NOT NULL DEFAULT '1',
  `delivery_state` varchar(24) COLLATE utf8mb4_bin NOT NULL DEFAULT 'PENDING_OFFLINE',
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  PRIMARY KEY (`zone_id`),
  KEY `safe_zones_family_recipient_idx` (`family_id`,`recipient_endpoint_id`),
  CONSTRAINT `safe_zones_ciphertext_check` CHECK ((length(`ciphertext`) between 1 and 65535)),
  CONSTRAINT `safe_zones_delivery_state_check` CHECK ((`delivery_state` in (_utf8mb4'PENDING_OFFLINE',_utf8mb4'READY'))),
  CONSTRAINT `safe_zones_key_epoch_check` CHECK ((`key_epoch` > 0)),
  CONSTRAINT `safe_zones_nonce_check` CHECK ((length(`nonce`) between 12 and 64))
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

-- settlement_accounts
CREATE TABLE `settlement_accounts` (
  `settlement_account_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `provider_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `display_label` varchar(64) COLLATE utf8mb4_bin NOT NULL,
  `settlement_currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `status` varchar(16) COLLATE utf8mb4_bin NOT NULL DEFAULT 'ACTIVE',
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`settlement_account_id`),
  KEY `settlement_accounts_status_idx` (`status`),
  KEY `settlement_accounts_currency_fk` (`settlement_currency`),
  CONSTRAINT `settlement_accounts_currency_fk` FOREIGN KEY (`settlement_currency`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `settlement_accounts_display_label_check` CHECK ((char_length(`display_label`) between 1 and 64)),
  CONSTRAINT `settlement_accounts_provider_ref_check` CHECK ((char_length(`provider_ref`) between 1 and 128)),
  CONSTRAINT `settlement_accounts_status_check` CHECK ((`status` in (_utf8mb4'ACTIVE',_utf8mb4'INACTIVE')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- settlement_batch_items
CREATE TABLE `settlement_batch_items` (
  `settlement_batch_item_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `settlement_batch_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `payment_transaction_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `amount_minor` bigint NOT NULL,
  `currency_code` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`settlement_batch_item_id`),
  UNIQUE KEY `settlement_batch_items_transaction_key` (`payment_transaction_id`),
  KEY `settlement_batch_items_batch_idx` (`settlement_batch_id`),
  KEY `settlement_batch_items_currency_fk` (`currency_code`),
  CONSTRAINT `settlement_batch_items_batch_fk` FOREIGN KEY (`settlement_batch_id`) REFERENCES `settlement_batches` (`settlement_batch_id`),
  CONSTRAINT `settlement_batch_items_currency_fk` FOREIGN KEY (`currency_code`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `settlement_batch_items_transaction_fk` FOREIGN KEY (`payment_transaction_id`) REFERENCES `billing_payment_transactions` (`payment_transaction_id`),
  CONSTRAINT `settlement_batch_items_amount_check` CHECK ((`amount_minor` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- settlement_batches
CREATE TABLE `settlement_batches` (
  `settlement_batch_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `settlement_account_ref` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `settlement_currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `period_start` datetime(3) NOT NULL,
  `period_end` datetime(3) NOT NULL,
  `expected_gross_minor` bigint NOT NULL,
  `fees_minor` bigint NOT NULL,
  `net_minor` bigint NOT NULL,
  `received_minor` bigint NOT NULL,
  `difference_minor` bigint NOT NULL,
  `status` varchar(24) COLLATE utf8mb4_bin NOT NULL,
  `provider_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `resolution_reason` varchar(500) COLLATE utf8mb4_bin DEFAULT NULL,
  `resolved_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  `resolved_at` datetime(3) DEFAULT NULL,
  `created_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  `usd_normalized_rate` decimal(24,10) DEFAULT NULL,
  `usd_normalized_recorded_at` datetime(3) DEFAULT NULL,
  `usd_normalized_by_admin_id` char(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  PRIMARY KEY (`settlement_batch_id`),
  KEY `settlement_batches_account_ref_idx` (`settlement_account_ref`),
  KEY `settlement_batches_status_idx` (`status`),
  KEY `settlement_batches_period_idx` (`period_start`,`period_end`),
  KEY `settlement_batches_currency_fk` (`settlement_currency`),
  KEY `settlement_batches_created_by_fk` (`created_by_admin_id`),
  KEY `settlement_batches_resolved_by_fk` (`resolved_by_admin_id`),
  KEY `settlement_batches_usd_norm_by_fk` (`usd_normalized_by_admin_id`),
  CONSTRAINT `settlement_batches_account_fk` FOREIGN KEY (`settlement_account_ref`) REFERENCES `settlement_accounts` (`settlement_account_id`),
  CONSTRAINT `settlement_batches_created_by_fk` FOREIGN KEY (`created_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `settlement_batches_currency_fk` FOREIGN KEY (`settlement_currency`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `settlement_batches_resolved_by_fk` FOREIGN KEY (`resolved_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `settlement_batches_usd_norm_by_fk` FOREIGN KEY (`usd_normalized_by_admin_id`) REFERENCES `platform_admin_accounts` (`admin_id`),
  CONSTRAINT `settlement_batches_amounts_nonneg_check` CHECK (((`expected_gross_minor` >= 0) and (`fees_minor` >= 0) and (`net_minor` >= 0) and (`received_minor` >= 0))),
  CONSTRAINT `settlement_batches_difference_check` CHECK ((`difference_minor` = (`received_minor` - `net_minor`))),
  CONSTRAINT `settlement_batches_period_check` CHECK ((`period_end` > `period_start`)),
  CONSTRAINT `settlement_batches_provider_ref_check` CHECK ((char_length(`provider_ref`) between 1 and 128)),
  CONSTRAINT `settlement_batches_resolution_pair_check` CHECK ((((`status` = _utf8mb4'RESOLVED') and (`resolution_reason` is not null) and (`resolved_by_admin_id` is not null) and (`resolved_at` is not null)) or ((`status` <> _utf8mb4'RESOLVED') and (`resolution_reason` is null) and (`resolved_by_admin_id` is null) and (`resolved_at` is null)))),
  CONSTRAINT `settlement_batches_status_check` CHECK ((`status` in (_utf8mb4'MATCHED',_utf8mb4'UNDER_INVESTIGATION',_utf8mb4'RESOLVED'))),
  CONSTRAINT `settlement_batches_usd_norm_pair_check` CHECK ((((`usd_normalized_rate` is null) and (`usd_normalized_recorded_at` is null) and (`usd_normalized_by_admin_id` is null)) or ((`usd_normalized_rate` is not null) and (`usd_normalized_recorded_at` is not null) and (`usd_normalized_by_admin_id` is not null)))),
  CONSTRAINT `settlement_batches_usd_norm_rate_check` CHECK (((`usd_normalized_rate` is null) or (`usd_normalized_rate` > 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- settlement_fx_snapshots
CREATE TABLE `settlement_fx_snapshots` (
  `settlement_fx_snapshot_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `settlement_batch_item_id` char(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `source_currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `settlement_currency` char(3) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `recorded_rate` decimal(24,10) NOT NULL,
  `effective_timestamp` datetime(3) NOT NULL,
  `provider_ref` varchar(128) COLLATE utf8mb4_bin NOT NULL,
  `created_at` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`settlement_fx_snapshot_id`),
  UNIQUE KEY `settlement_fx_snapshots_item_key` (`settlement_batch_item_id`),
  KEY `settlement_fx_snapshots_source_currency_fk` (`source_currency`),
  KEY `settlement_fx_snapshots_settlement_currency_fk` (`settlement_currency`),
  CONSTRAINT `settlement_fx_snapshots_item_fk` FOREIGN KEY (`settlement_batch_item_id`) REFERENCES `settlement_batch_items` (`settlement_batch_item_id`),
  CONSTRAINT `settlement_fx_snapshots_settlement_currency_fk` FOREIGN KEY (`settlement_currency`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `settlement_fx_snapshots_source_currency_fk` FOREIGN KEY (`source_currency`) REFERENCES `billing_currencies` (`currency_code`),
  CONSTRAINT `settlement_fx_snapshots_currency_pair_check` CHECK ((`source_currency` <> `settlement_currency`)),
  CONSTRAINT `settlement_fx_snapshots_provider_ref_check` CHECK ((char_length(`provider_ref`) between 1 and 128)),
  CONSTRAINT `settlement_fx_snapshots_rate_check` CHECK ((`recorded_rate` > 0))
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
