import type { MessageId } from './types.js';

/**
 * Per-messageId record of the canonical bytes of the envelope that was
 * fully ACCEPTED under that id (doc 22 Section 3: messageId is "globally
 * unique for idempotency," "stable across relay retransmission"; Section
 * 7's contract test: "valid signed policy delivered twice -> exactly one
 * application and stable receipt").
 *
 * This is deliberately separate from ReplayLedger: ReplayLedger is a
 * SECURITY control (a captured-and-replayed old sequence/nonce must
 * never be re-applied, full stop). MessageIdempotencyLedger is an
 * APPLICATION-level exactly-once-effect guarantee -- a legitimate
 * at-least-once redelivery of the SAME already-accepted envelope (same
 * messageId, byte-identical canonical content) must succeed identically,
 * not be rejected as a replay.
 *
 * Only a fully-accepted envelope's canonical bytes may be recorded here
 * -- recording on any rejection path would let a forged or malformed
 * envelope poison a legitimate future messageId.
 */
/** PCA-SYNC-DURABILITY-1: async, see ReplayLedger.ts's identical note. */
export interface MessageIdempotencyLedger {
  /** Returns the canonical bytes previously accepted under this messageId, or null if none. */
  getAcceptedCanonicalBytes(messageId: MessageId): Promise<string | null>;
  recordAccepted(messageId: MessageId, canonicalBytes: string): Promise<void>;
}
