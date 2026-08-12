import { describe, expect, it } from 'vitest';
import { canTransition, initialStatusAfterSubmit, isUnconfirmedStatus } from '../../src/domain/policyStatus';

describe('policy status lifecycle', () => {
  it('permits the documented online submit -> applied flow', () => {
    expect(canTransition('LOCAL_DRAFT', 'PENDING_SYNC')).toBe(true);
    expect(canTransition('PENDING_SYNC', 'PENDING_DELIVERY')).toBe(true);
    expect(canTransition('PENDING_DELIVERY', 'DELIVERED')).toBe(true);
    expect(canTransition('DELIVERED', 'APPLIED')).toBe(true);
  });

  it('permits a previously applied revision going stale when superseded', () => {
    expect(canTransition('APPLIED', 'STALE')).toBe(true);
    expect(canTransition('STALE', 'PENDING_DELIVERY')).toBe(true);
    expect(canTransition('STALE', 'APPLIED')).toBe(true);
  });

  it('rejects illegal jumps directly to APPLIED', () => {
    expect(canTransition('LOCAL_DRAFT', 'APPLIED')).toBe(false);
    expect(canTransition('PENDING_SYNC', 'APPLIED')).toBe(false);
    expect(canTransition('PENDING_DELIVERY', 'APPLIED')).toBe(false);
  });

  it('permits recovering from FAILED/EXPIRED back into the sync pipeline', () => {
    expect(canTransition('FAILED', 'PENDING_SYNC')).toBe(true);
    expect(canTransition('EXPIRED', 'PENDING_SYNC')).toBe(true);
  });

  it('every status except APPLIED is considered unconfirmed', () => {
    expect(isUnconfirmedStatus('APPLIED')).toBe(false);
    for (const status of ['LOCAL_DRAFT', 'PENDING_SYNC', 'PENDING_DELIVERY', 'DELIVERED', 'FAILED', 'EXPIRED', 'STALE'] as const) {
      expect(isUnconfirmedStatus(status)).toBe(true);
    }
  });

  it('an offline submit becomes a LOCAL_DRAFT, an online submit becomes PENDING_SYNC -- never APPLIED', () => {
    expect(initialStatusAfterSubmit(true)).toBe('LOCAL_DRAFT');
    expect(initialStatusAfterSubmit(false)).toBe('PENDING_SYNC');
  });
});
