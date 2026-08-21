-- PCA-ADD-ENR-016/PCA-FR-145 (doc 08 Section 8): a durable, server-side,
-- authenticated record of each device's own self-reported protection
-- level (PCA-ADD-ENR-019's STANDARD/PROTECTED/DEGRADED/
-- AUTHORIZATION_REQUIRED/NOT_SUPPORTED vocabulary), written only via a
-- device-session-authenticated request (requireDeviceSession, the SAME
-- verified runtime-sync channel every other device-identity-bound
-- runtime-sync route already uses -- never a caller-supplied familyId/
-- deviceId, never a Parent Web-supplied value). This is what
-- RealProtectiveAuthorityResolver reads instead of trusting a client-
-- asserted protectionLevel at removal-request-creation time.
--
-- One row per device (the device's current, latest-known status -- not a
-- history log; matches devices.status's own single-current-value shape).
-- updated_at is the SERVER's own receipt clock, not a device-claimed
-- timestamp, so RealProtectiveAuthorityResolver's freshness bound cannot
-- be satisfied by a device replaying/backdating an old report.

CREATE TABLE device_protection_status (
  device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  protection_level VARCHAR(32) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (device_id),
  KEY device_protection_status_family_id_idx (family_id),
  CONSTRAINT device_protection_status_device_id_fk FOREIGN KEY (device_id) REFERENCES devices (device_id),
  CONSTRAINT device_protection_status_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128),
  CONSTRAINT device_protection_status_level_check CHECK (protection_level IN ('STANDARD', 'PROTECTED', 'DEGRADED', 'AUTHORIZATION_REQUIRED', 'NOT_SUPPORTED'))
) ENGINE=InnoDB;
