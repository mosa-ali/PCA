import { describe, expect, it } from 'vitest';
import { isLocationRetentionWithinGeneral } from '../../src/api/retention';

describe('retention policy UI guard', () => {
  it('allows current-only and shorter or equal location windows', () => {
    expect(isLocationRetentionWithinGeneral('14_DAYS', 'CURRENT_LAST_ONLY')).toBe(true);
    expect(isLocationRetentionWithinGeneral('3_MONTHS', { window: '14_DAYS' })).toBe(true);
    expect(isLocationRetentionWithinGeneral('3_MONTHS', { window: '3_MONTHS' })).toBe(true);
  });

  it('rejects longer or unknown windows without trusting server ordering', () => {
    expect(isLocationRetentionWithinGeneral('14_DAYS', { window: '9_MONTHS' })).toBe(false);
    expect(isLocationRetentionWithinGeneral(null, { window: '14_DAYS' })).toBe(false);
  });
});
