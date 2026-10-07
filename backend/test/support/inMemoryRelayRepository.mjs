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

  function comparePosition(a, b) {
    return a.createdAtMs - b.createdAtMs || Buffer.compare(Buffer.from(a.messageId, 'utf8'), Buffer.from(b.messageId, 'utf8'));
  }

  const position = (record) => ({ createdAtMs: record.createdAt.getTime(), messageId: record.messageId });
  const queuedClone = (record) => ({ ...clone(record), ciphertext: record.ciphertext.length <= 65536 ? Buffer.from(record.ciphertext) : null });

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

    async listQueuedPageForRecipient(recipientDeviceId, familyId, now, input) {
      if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new RangeError('Invalid page limit');
      const eligible = [...byMessageId.values()].filter((record) => record.recipientDeviceId === recipientDeviceId
        && record.familyId === familyId && record.state === 'QUEUED' && record.expiresAt > now)
        .sort((a, b) => comparePosition(position(a), position(b)));
      const highWater = input.highWater ?? (eligible.length ? position(eligible.at(-1)) : null);
      const candidates = highWater === null ? [] : eligible.filter((record) => comparePosition(position(record), highWater) <= 0
        && (input.after === null || comparePosition(position(record), input.after) > 0));
      return { records: candidates.slice(0, input.limit).map(queuedClone), highWater, hasMore: candidates.length > input.limit };
    },

    async findQueuedForRecipient(recipientDeviceId, familyId, messageIds, now) {
      if (messageIds.length > 16) throw new RangeError('Supplement bound exceeded');
      return messageIds.map((id) => byMessageId.get(id)).filter((record) => record && record.recipientDeviceId === recipientDeviceId
        && record.familyId === familyId && record.state === 'QUEUED' && record.expiresAt > now)
        .sort((a, b) => comparePosition(position(a), position(b))).map(queuedClone);
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
