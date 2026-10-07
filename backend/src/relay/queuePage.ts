import type { RelayEnvelopeRecord } from './types.js';

/** Transport navigation only. Neither a position nor a page is envelope authority. */
export interface RelayQueuePosition {
  createdAtMs: number;
  messageId: string;
}

export type RelayQueuedRecord = Omit<RelayEnvelopeRecord, 'ciphertext'> & {
  /** Oversized stored ciphertext is not loaded into application memory. It remains queued. */
  ciphertext: Buffer | null;
};

export interface RelayQueuePage {
  records: RelayQueuedRecord[];
  highWater: RelayQueuePosition | null;
  hasMore: boolean;
}

export interface RelayQueuePageInput {
  after: RelayQueuePosition | null;
  highWater: RelayQueuePosition | null;
  limit: number;
}

export const MAX_RELAY_PAGE_RECORDS = 100;
export const MAX_RELAY_SUPPLEMENT_RECORDS = 16;

export function relayQueuePosition(record: Pick<RelayEnvelopeRecord, 'createdAt' | 'messageId'>): RelayQueuePosition {
  return { createdAtMs: record.createdAt.getTime(), messageId: record.messageId };
}

/** Matches SQL created_at then CAST(message_id AS BINARY), including trailing spaces and supplementary Unicode. */
export function compareRelayQueuePositions(a: RelayQueuePosition, b: RelayQueuePosition): number {
  return a.createdAtMs - b.createdAtMs || Buffer.compare(Buffer.from(a.messageId, 'utf8'), Buffer.from(b.messageId, 'utf8'));
}

export function isRelayQueuePosition(value: unknown): value is RelayQueuePosition {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const position = value as Record<string, unknown>;
  return Object.keys(position).length === 2
    && Number.isSafeInteger(position.createdAtMs)
    && (position.createdAtMs as number) >= -30610224000000
    && (position.createdAtMs as number) <= 253402300799999
    && typeof position.messageId === 'string'
    && Array.from(position.messageId).length >= 1 && Array.from(position.messageId).length <= 128
    && Buffer.from(position.messageId, 'utf8').toString('utf8') === position.messageId;
}

export function validateRelayQueuePageInput(input: RelayQueuePageInput): void {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_RELAY_PAGE_RECORDS
      || (input.after !== null && !isRelayQueuePosition(input.after))
      || (input.highWater !== null && !isRelayQueuePosition(input.highWater))
      || (input.after !== null && (input.highWater === null || compareRelayQueuePositions(input.after, input.highWater) >= 0))) {
    throw new RangeError('Invalid relay page navigation.');
  }
}
