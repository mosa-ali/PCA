-- PCA-FAMILY-AUTH-1-R1 (PCA-DEC-025, OWNER_APPROVED_OPTION_A: genesis-anchored
-- Owner-attestation signature chain). See
-- docs/implementation/decisions/PCA_IMPL_DECISION_002_FAMILY_COMMERCIAL_AUTHORITY.md
-- and backend/src/familycommercial/authority/ for the full design.
--
-- WHAT THIS SCHEMA IS NOT: none of these three tables is a server-authored
-- role ACL. Every row this migration's tables can ever hold is either (a) a
-- self-certified genesis anchor -- checked, not authored, at a family's
-- server-authorized bootstrap ceremony -- or (b) an already
-- signature-verified attestation the server only ever appends after
-- checking it traces back to that anchor (see
-- FamilyOwnerAttestationChainEngine, which is the ONLY writer of these
-- tables). There is no column here the server can set to make a device
-- Owner independent of a valid signature; `family_authority_chain_heads` is
-- a POINTER to an already-verified attestation, never a role assignment
-- typed directly as `role = 'OWNER'`.
--
-- PRIVACY BOUNDARY (unchanged from 0001-0008, doc 09 Section 5.2/PCA-SEC-023):
-- every column is opaque identity/verification/lineage metadata (ids,
-- revision counters, timestamps, PUBLIC signing keys, signatures). No
-- Administrator/Viewer/Child role, membership list, or any other family
-- RBAC assignment is representable in this schema at all -- this package
-- only ever resolves "who is the current Owner," the single narrow fact
-- billing/authority/FamilyCommercialAuthorityResolver.ts needs, never the
-- full trust set. No FDEK/DEK/private DSK/recovery-secret material, no
-- activity/usage/location/policy plaintext.
--
-- CONCURRENCY: `family_authority_genesis_anchors.family_id` is the primary
-- key, so a race between two concurrent bootstrap attempts for the same
-- family resolves to exactly one row via a unique-key conflict (mission
-- Section 26) -- see MySqlFamilyAuthorityGenesisStore.createIfAbsent.
-- `family_authority_chain_heads` is a single mutable row per family whose
-- pointer only ever advances via a revision-guarded UPDATE (mission Section
-- 27) -- see MySqlFamilyAuthorityAttestationChainStore.appendIfCurrentRevision.
-- `family_authority_attestations` is append-only; existing rows are never
-- updated or deleted by this package.
--
-- INDEPENDENT OF 0012: this migration has no foreign key to, and no
-- dependency on, Agent54's 0012_commercial_notifications.sql. It only
-- extends the 0001-0008 baseline (no edits to those files).

CREATE TABLE family_authority_genesis_anchors (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  genesis_device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  genesis_dsk_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  -- PUBLIC signing key only -- same class of value already accepted into
  -- device_public_keys.public_key (0001_mysql_baseline.sql). No private
  -- key material is ever representable here.
  genesis_dsk_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  protocol_version SMALLINT UNSIGNED NOT NULL,
  created_at DATETIME(3) NOT NULL,
  -- Self-signature by genesis_dsk_public_key's private key over the
  -- canonical (family_id, genesis_device_id, genesis_dsk_key_id,
  -- genesis_dsk_public_key, protocol_version, created_at) tuple -- see
  -- familycommercial/authority/canonicalize.ts. Opaque to this schema; only
  -- ever interpreted by the injected DeviceSignatureVerifier.
  signature VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (family_id),
  CONSTRAINT family_authority_genesis_anchors_protocol_version_check CHECK (protocol_version BETWEEN 1 AND 100),
  CONSTRAINT family_authority_genesis_anchors_family_id_check CHECK (CHAR_LENGTH(family_id) BETWEEN 1 AND 128)
) ENGINE=InnoDB;

CREATE TABLE family_authority_attestations (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Content-addressed id: sha256 hex of the attestation's canonical bytes +
  -- signature (computeAttestationId). Server-assigned at verification time,
  -- never caller-supplied.
  attestation_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  attestation_revision INT UNSIGNED NOT NULL,
  owner_device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_dsk_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  owner_dsk_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Device-side FTS lineage this attestation was issued against
  -- (freshness/lineage signal only -- this table never resolves or stores
  -- FTS role content itself; see FamilyTrustSetStore's own "device-local,
  -- never server-side source of truth" header).
  trust_set_epoch INT UNSIGNED NOT NULL,
  key_epoch INT UNSIGNED NOT NULL,
  issued_at DATETIME(3) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  -- NULL only for attestation_revision = 1 (the genesis self-attestation).
  previous_attestation_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  -- Revision 1: equals genesis_device_id (self-certification). Revision >
  -- 1: equals the PRIOR revision's owner_device_id (the outgoing Owner
  -- authorizes the transfer; the server never authorizes it itself).
  signer_device_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  signer_dsk_key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  signer_dsk_public_key VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  signature VARCHAR(512) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (family_id, attestation_id),
  UNIQUE KEY family_authority_attestations_family_revision_key (family_id, attestation_revision),
  CONSTRAINT family_authority_attestations_genesis_fk FOREIGN KEY (family_id) REFERENCES family_authority_genesis_anchors (family_id),
  CONSTRAINT family_authority_attestations_revision_check CHECK (attestation_revision >= 1),
  CONSTRAINT family_authority_attestations_ttl_check CHECK (expires_at > issued_at)
) ENGINE=InnoDB;

CREATE TABLE family_authority_chain_heads (
  family_id VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  head_attestation_id CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  head_revision INT UNSIGNED NOT NULL,
  -- REVOKED is set in place (mission Section 13): the pointer itself does
  -- not move when there is no successor attestation yet, so a resolution
  -- against a revoked head must fail STALE_OR_REVOKED, never fall through
  -- to whatever attestation row head_attestation_id still names.
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (family_id),
  CONSTRAINT family_authority_chain_heads_genesis_fk FOREIGN KEY (family_id) REFERENCES family_authority_genesis_anchors (family_id),
  CONSTRAINT family_authority_chain_heads_attestation_fk FOREIGN KEY (family_id, head_attestation_id) REFERENCES family_authority_attestations (family_id, attestation_id),
  CONSTRAINT family_authority_chain_heads_status_check CHECK (status IN ('ACTIVE', 'REVOKED'))
) ENGINE=InnoDB;
