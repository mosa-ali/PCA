export type ChallengeId = string;
export type DeviceId = string;
export type OpaqueFamilyId = string;

/**
 * A single-use, short-lived proof-of-possession challenge: the server
 * generates a random nonce and asks the device to sign it with its DSK
 * (see doc 09 Section 3.1 for the DSK/DEK role split). This record is
 * intentionally protocol-neutral -- it says nothing about which signature
 * algorithm produced/verifies the signature, only the challenge lifecycle
 * (issued -> consumed exactly once, or expired unconsumed). Concrete
 * algorithm selection is gated behind CRYPTO_SUITE =
 * WAITING_HUMAN_SECURITY_REVIEW (doc 09 PCA-DEC-020).
 */
export interface DeviceChallengeRecord {
  challengeId: ChallengeId;
  deviceId: DeviceId;
  familyId: OpaqueFamilyId;
  /** Opaque, high-entropy, single-use bytes the device must sign. Never itself secret -- the SIGNATURE over it is what proves key possession. */
  nonce: string;
  createdAt: Date;
  expiresAt: Date;
  /** Set exactly once, atomically, by the first successful verification -- see DeviceChallengeRepository.consumeAtomically. Never reset. */
  consumedAt: Date | null;
}
