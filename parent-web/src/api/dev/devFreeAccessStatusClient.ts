import type { FreeAccessStatusClient } from '../interfaces';
import type { FreeAccessStatus } from '../../domain/freeAccess';

const DELAY_MS = 120;
const delay = (ms = DELAY_MS) => new Promise((r) => setTimeout(r, ms));

/**
 * DEVELOPMENT_ONLY fixture: a TIME_LIMITED account, 7 days remaining
 * (illustrative, mid-range on the 30/7/3/1 reminder ladder). Never
 * presented as if it were real production data -- see DemoBanner.
 */
function fixtureStatus(): FreeAccessStatus {
  const now = Date.now();
  const expiresAt = new Date(now + 7 * 24 * 60 * 60 * 1000);
  const grantedAt = new Date(now - 23 * 24 * 60 * 60 * 1000);
  return {
    mode: 'TIME_LIMITED',
    grantedAt: grantedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    remainingDays: 7,
    status: 'ACTIVE',
  };
}

export class DevFreeAccessStatusClient implements FreeAccessStatusClient {
  async getStatus(): Promise<FreeAccessStatus | null> {
    await delay();
    return fixtureStatus();
  }
}
