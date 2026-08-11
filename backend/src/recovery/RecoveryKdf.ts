/**
 * Derives the ephemeral Recovery Wrapping Key (RWK) from the offline
 * Recovery Secret (RS) plus the recorded KDF suite/salt (doc 09 Section
 * 3.1/3.4: "a reviewed KDF derives an ephemeral RWK"). The RS never
 * derives the FDEK directly -- RWK exists only to open the recovery
 * envelope (see RecoveryEnvelopeCipher).
 *
 * NO concrete KDF (Argon2id, scrypt, PBKDF2, HKDF, ...) is selected or
 * implemented anywhere behind this interface, for the same reason as
 * src/familytrustset/TrustSetSignatureVerifier.ts and
 * src/familyenvelope/EnvelopeSignatureVerifier.ts: production suite
 * selection is gated behind CRYPTO_SUITE = WAITING_HUMAN_SECURITY_REVIEW
 * (doc 09 Section 3.1/3.6, PCA-DEC-021). `recoverySecret` and the returned
 * RWK are both caller-owned, ephemeral, and must be zeroized by the
 * caller once the recovery envelope has been opened (doc 09 Section 3.1's
 * RWK row: "Only while creating/opening a recovery envelope ... zeroized
 * afterwards") -- this interface does not own that lifecycle, only the
 * derivation step.
 */
export interface RecoveryKdfSuite {
  /** Opaque identifier for the concrete KDF construction + parameters used, recorded in the recovery envelope's associated data (doc 09 Section 3.4) so a later change of default suite does not silently reinterpret an older envelope's salt/cost parameters. */
  readonly suiteId: string;
}

export interface RecoveryKdf {
  derive(recoverySecret: Buffer, salt: Buffer, suite: RecoveryKdfSuite): Promise<Buffer>;
}
