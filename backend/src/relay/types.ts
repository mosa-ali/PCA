export type MessageId = string;
export type OpaqueFamilyId = string;
export type OpaqueDeviceId = string;
export type RelayDeliveryState = 'QUEUED' | 'ACKNOWLEDGED' | 'EXPIRED';

/**
 * Opaque store-and-forward envelope. The relay is ciphertext-blind: it may
 * only understand the fields below, never the meaning of `ciphertext`. This
 * record must never grow a field for decrypted content, policy, or any
 * other readable family data -- the relay is not a family-authority source,
 * only a delivery mechanism device-side crypto/E2EE slices route through.
 */
export interface RelayEnvelopeRecord {
  messageId: MessageId;
  familyId: OpaqueFamilyId;
  senderDeviceId: OpaqueDeviceId;
  recipientDeviceId: OpaqueDeviceId;
  ciphertext: Buffer;
  state: RelayDeliveryState;
  createdAt: Date;
  expiresAt: Date;
  acknowledgedAt: Date | null;
}
