-- Service control-plane authentication. This is SERVICE authority only
-- (account/session), never family E2EE authority (Owner/Administrator/
-- Viewer/Child roles live in the device-side Family Trust Set, never here).
--
-- Raw session bearer tokens are never stored -- only a one-way hash. No
-- password/credential material exists in this schema: identity
-- verification happens upstream (a provider-neutral boundary implemented
-- in application code), and this table only tracks the resulting opaque
-- session, exactly as service_accounts already only tracks an opaque
-- account_reference_hash rather than any raw identity.

CREATE TABLE service_sessions (
  session_id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES service_accounts (account_id),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  issued_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX service_sessions_account_id_idx ON service_sessions (account_id);
