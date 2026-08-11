-- Device-authentication challenges (protocol-neutral foundation): a
-- single-use, short-TTL nonce a device signs with its registered DSK to
-- prove key possession. No signature algorithm is implied by this schema;
-- concrete suite selection remains gated behind CRYPTO_SUITE =
-- WAITING_HUMAN_SECURITY_REVIEW (doc 09 PCA-DEC-020).

CREATE TABLE device_challenges (
  challenge_id UUID PRIMARY KEY,
  device_id UUID NOT NULL REFERENCES devices (device_id),
  family_id TEXT NOT NULL CHECK (char_length(family_id) BETWEEN 1 AND 128),
  nonce TEXT NOT NULL CHECK (char_length(nonce) BETWEEN 1 AND 256),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ
);

CREATE INDEX device_challenges_device_id_idx ON device_challenges (device_id);
