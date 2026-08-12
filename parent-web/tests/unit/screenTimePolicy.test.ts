import { describe, expect, it } from 'vitest';
import {
  BREAK_DURATION_MAX_MINUTES,
  CONTINUOUS_USE_LIMIT_MAX_MINUTES,
  CONTINUOUS_USE_LIMIT_MIN_MINUTES,
  isBaselineCompliantScreenTimePolicy,
  validateScreenTimePolicy,
} from '../../src/domain/screenTimePolicy';

describe('validateScreenTimePolicy -- PCA-SCREEN-BASELINE-1 non-weakenable 60/30 rule', () => {
  it.each([
    ['exact baseline 60/30', 60, 30],
    ['stricter continuous-use limit 45/30', 45, 30],
    ['stricter break duration 30/45', 30, 45],
    ['stricter break duration 60/90', 60, 90],
    ['minimum supported continuous-use limit', CONTINUOUS_USE_LIMIT_MIN_MINUTES, 30],
    ['maximum supported break duration', 60, BREAK_DURATION_MAX_MINUTES],
  ])('accepts %s', (_label, continuousUseLimitMinutes, breakDurationMinutes) => {
    const result = validateScreenTimePolicy({ continuousUseLimitMinutes, breakDurationMinutes });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(isBaselineCompliantScreenTimePolicy({ continuousUseLimitMinutes, breakDurationMinutes })).toBe(true);
  });

  it.each([
    ['continuous-use limit above 60 (61/30)', 61, 30, 'CONTINUOUS_USE_LIMIT_TOO_HIGH'],
    ['break duration below 30 (60/29)', 60, 29, 'BREAK_DURATION_TOO_LOW'],
    ['grossly weak policy (180/5)', 180, 5, 'CONTINUOUS_USE_LIMIT_TOO_HIGH'],
    ['continuous-use limit below the existing minimum', CONTINUOUS_USE_LIMIT_MIN_MINUTES - 1, 30, 'CONTINUOUS_USE_LIMIT_TOO_LOW'],
    ['break duration above the sane ceiling', 60, BREAK_DURATION_MAX_MINUTES + 1, 'BREAK_DURATION_TOO_HIGH'],
    ['continuous-use limit far above the ceiling', CONTINUOUS_USE_LIMIT_MAX_MINUTES + 120, 30, 'CONTINUOUS_USE_LIMIT_TOO_HIGH'],
  ])('rejects %s', (_label, continuousUseLimitMinutes, breakDurationMinutes, expectedError) => {
    const result = validateScreenTimePolicy({ continuousUseLimitMinutes, breakDurationMinutes });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedError);
    expect(isBaselineCompliantScreenTimePolicy({ continuousUseLimitMinutes, breakDurationMinutes })).toBe(false);
  });

  it('rejects the classic weakened-180/5 combo with both errors surfaced', () => {
    const result = validateScreenTimePolicy({ continuousUseLimitMinutes: 180, breakDurationMinutes: 5 });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['CONTINUOUS_USE_LIMIT_TOO_HIGH', 'BREAK_DURATION_TOO_LOW']),
    );
  });

  it('rejects non-numeric input rather than silently coercing it', () => {
    const result = validateScreenTimePolicy({
      continuousUseLimitMinutes: Number.NaN,
      breakDurationMinutes: Number.POSITIVE_INFINITY,
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining(['CONTINUOUS_USE_LIMIT_NOT_A_NUMBER', 'BREAK_DURATION_NOT_A_NUMBER']),
    );
  });

  it('never depends on network or timers -- pure and synchronous', () => {
    // No await, no fake timers, no network mocks needed: validation must be usable fully offline.
    const result = validateScreenTimePolicy({ continuousUseLimitMinutes: 60, breakDurationMinutes: 30 });
    expect(result.valid).toBe(true);
  });
});
