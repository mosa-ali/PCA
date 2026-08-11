// Deterministic in-memory RelayRepository for tests only.
// Never used as a production substitute for the MySQL implementation.
export function createInMemoryRelayRepository() {
  const byMessageId = new Map();
  const messageIdsByRecipient = new Map(); // recipientDeviceId -> Set<messageId>

  function clone(record) {
    return { ...record, ciphertext: Buffer.from(record.ciphertext) };
  }

  function matchesExisting(existing, candidate) {
    return (
      existing.familyId === candidate.familyId &&
      existing.senderDeviceId === candidate.senderDeviceId &&
      existing.recipientDeviceId === candidate.recipientDeviceId &&
      existing.ciphertext.equals(candidate.ciphertext)
    );
  }

  return {
    // No `await` before any mutation below, so each call runs to completion
    // synchronously once invoked -- concurrent submissions of the same
    // messageId cannot interleave.
    async createOrMatchEnvelope(record) {
      const existing = byMessageId.get(record.messageId);
      if (existing) {
        return matchesExisting(existing, record)
          ? { outcome: 'IDEMPOTENT_MATCH', record: clone(existing) }
          : { outcome: 'CONFLICT' };
      }
      const stored = clone(record);
      byMessageId.set(record.messageId, stored);
      if (!messageIdsByRecipient.has(record.recipientDeviceId)) {
        messageIdsByRecipient.set(record.recipientDeviceId, new Set());
      }
      messageIdsByRecipient.get(record.recipientDeviceId).add(record.messageId);
      return { outcome: 'CREATED', record: clone(stored) };
    },

    async findForRecipient(recipientDeviceId, messageId) {
      const record = byMessageId.get(messageId);
      if (!record || record.recipientDeviceId !== recipientDeviceId) return null;
      return clone(record);
    },

    async listQueuedForRecipient(recipientDeviceId, now) {
      const ids = messageIdsByRecipient.get(recipientDeviceId) ?? new Set();
      const results = [];
      for (const messageId of ids) {
        const record = byMessageId.get(messageId);
        if (record.state === 'QUEUED' && now.getTime() < record.expiresAt.getTime()) {
          results.push(clone(record));
        }
      }
      return results;
    },

    async acknowledgeAtomically(recipientDeviceId, messageId, acknowledgedAt) {
      const record = byMessageId.get(messageId);
      if (!record || record.recipientDeviceId !== recipientDeviceId) return { outcome: 'NOT_FOUND' };
      if (record.state === 'ACKNOWLEDGED') return { outcome: 'ACKNOWLEDGED', record: clone(record) };
      if (acknowledgedAt.getTime() >= record.expiresAt.getTime()) return { outcome: 'EXPIRED' };
      record.state = 'ACKNOWLEDGED';
      record.acknowledgedAt = acknowledgedAt;
      return { outcome: 'ACKNOWLEDGED', record: clone(record) };
    },
  };
}
