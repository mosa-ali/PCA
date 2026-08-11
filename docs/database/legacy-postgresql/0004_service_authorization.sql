-- Minimal service control-plane authorization relation. This means ONLY
-- "this service account may perform allowed service-plane operations for
-- this opaque family service scope" -- it is NOT a family role/RBAC table.
--
-- No OWNER/ADMINISTRATOR/VIEWER/CHILD role is stored here, and none may
-- ever be added: those roles are Family Trust Set authority, established
-- and enforced device-side through the signed FTS/E2EE protocol, never by
-- this server-side table. This table cannot authorize family policy,
-- retention control, child removal, or family activity reads -- see
-- src/authz/policy.ts for the operations it CAN gate.

CREATE TABLE service_account_family_scopes (
  account_id UUID NOT NULL REFERENCES service_accounts (account_id),
  family_id TEXT NOT NULL CHECK (char_length(family_id) BETWEEN 1 AND 128),
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'REVOKED')),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (account_id, family_id)
);

CREATE INDEX service_account_family_scopes_family_id_idx ON service_account_family_scopes (family_id);
