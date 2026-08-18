-- PCA-ADD-PA-020: durable security-alert inbox for Platform Administration.
-- A failed login or lockout on an APP_OWNER/FINANCE_ADMIN account creates one
-- pending row for every other active APP_OWNER. The row is an opaque,
-- recipient-scoped operational notification; delivery to email/SMS/paging is
-- a separate external gate and is never represented by raw contact data here.
CREATE TABLE platform_admin_security_alerts (
  alert_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recipient_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  source_admin_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind VARCHAR(20) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  correlation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  delivery_state VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  delivered_at DATETIME(3) NULL,
  PRIMARY KEY (alert_id),
  UNIQUE KEY platform_admin_security_alerts_correlation_recipient_key (correlation_id, recipient_admin_id),
  KEY platform_admin_security_alerts_recipient_state_idx (recipient_admin_id, delivery_state, occurred_at),
  CONSTRAINT platform_admin_security_alerts_recipient_fk FOREIGN KEY (recipient_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_security_alerts_source_fk FOREIGN KEY (source_admin_id) REFERENCES platform_admin_accounts (admin_id),
  CONSTRAINT platform_admin_security_alerts_kind_check CHECK (kind IN ('LOGIN_FAILED', 'LOCKED_OUT')),
  CONSTRAINT platform_admin_security_alerts_delivery_state_check CHECK (delivery_state IN ('PENDING', 'DELIVERED')),
  CONSTRAINT platform_admin_security_alerts_delivery_timestamp_check CHECK ((delivery_state = 'PENDING' AND delivered_at IS NULL) OR (delivery_state = 'DELIVERED' AND delivered_at IS NOT NULL))
) ENGINE=InnoDB;
