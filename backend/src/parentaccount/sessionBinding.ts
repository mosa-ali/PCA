import { createHash } from 'node:crypto';

/** Stores only a one-way binding to an AuthService session identifier. */
export function hashGenesisSessionId(sessionId: string): string {
  return createHash('sha256').update('PCA_PARENT_GENESIS_SESSION_V1\0', 'utf8').update(sessionId, 'utf8').digest('hex');
}
