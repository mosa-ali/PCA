import { describe, expect, it } from 'vitest';
import {
  WELLBEING_CATEGORIES as SDK_CATEGORIES,
  WELLBEING_TRIGGERS as SDK_TRIGGERS,
} from '@pca/parent-sdk-wellbeing-control';
import { WELLBEING_CATEGORIES, WELLBEING_TRIGGERS } from '../../src/domain/wellbeing';
import { DEV_CURATED_SUGGESTIONS, DEV_WELLBEING_CONTROL } from '../../src/api/dev/fixtures';
import en from '../../src/i18n/locales/en.json';
import ar from '../../src/i18n/locales/ar.json';

/**
 * parent-web must not carry a second wellbeing taxonomy.
 *
 * Android's `feature/wellbeing` runtime is canonical
 * (docs/architecture/38_CANONICAL_WELLBEING_POLICY.md Section 1); the
 * parent-authoring expression of it is
 * `@pca/parent-sdk-wellbeing-control` (PCA-WELL-006 / PCA-WELLCTRL-031 --
 * 13 categories; PCA-WELLCTRL-032 -- 9 triggers). parent-web previously
 * declared its own 6 categories / 6 triggers with no supporting requirement,
 * which the contract, the parent SDK and Android all already disagreed with.
 * These assertions are what stop that from being reintroduced.
 */

// Transcribed from the requirements, NOT from the SDK -- so that a change to
// the SDK's arrays alone cannot silently redefine what "canonical" means here.
const CANONICAL_CATEGORIES = [
  'SKILLS_AND_LEARNING', 'READING', 'FAITH_POSITIVE', 'GRATITUDE', 'GOOD_DEED',
  'FAMILY_HELP', 'HOME_RESPONSIBILITY', 'CREATIVITY', 'MOVEMENT_RESET',
  'REST_AND_RESET', 'OUTDOOR_OR_OFFSCREEN', 'PLANNING_AND_ORGANIZATION', 'CUSTOM',
];

const CANONICAL_TRIGGERS = [
  'PERIODIC', 'AFTER_UNLOCK', 'RAPID_GAME_RETURN', 'BREAK_STARTED', 'BREAK_ACTIVE',
  'BREAK_COMPLETED', 'LONG_SESSION_ENDED', 'SCHEDULED_TIME', 'CHILD_REQUESTED_IDEA',
];

// The local enum parent-web used to define. None of these may come back.
const RETIRED_VALUES = [
  'ENCOURAGEMENT', 'BREAK_REMINDER', 'FOCUS', 'SAFETY_CHECK_IN',
  'BREAK_DUE', 'CONTINUOUS_USE_WARNING', 'APP_LAUNCH', 'SCHEDULED_TIME_WINDOW',
  'LOCK_SCREEN', 'MANUAL',
];

describe('parent-web wellbeing taxonomy conforms to the canonical vocabulary', () => {
  it('re-exports the parent SDK constants rather than restating them', () => {
    expect(WELLBEING_CATEGORIES).toBe(SDK_CATEGORIES);
    expect(WELLBEING_TRIGGERS).toBe(SDK_TRIGGERS);
  });

  it('offers exactly PCA-WELLCTRL-031 categories and PCA-WELLCTRL-032 triggers', () => {
    expect([...WELLBEING_CATEGORIES]).toEqual(CANONICAL_CATEGORIES);
    expect([...WELLBEING_TRIGGERS]).toEqual(CANONICAL_TRIGGERS);
  });

  it('labels every category and trigger in both locales, with no stale keys left over', () => {
    for (const locale of [en, ar]) {
      expect(Object.keys(locale.wellbeing.categories).sort()).toEqual([...CANONICAL_CATEGORIES].sort());
      expect(Object.keys(locale.wellbeing.triggerLabels).sort()).toEqual([...CANONICAL_TRIGGERS].sort());
      for (const value of [
        ...Object.values(locale.wellbeing.categories),
        ...Object.values(locale.wellbeing.triggerLabels),
      ]) {
        expect(String(value).trim()).not.toBe('');
      }
    }
  });

  it('tags every demo fixture with a canonical category and canonical triggers', () => {
    const messages = [...DEV_CURATED_SUGGESTIONS, ...DEV_WELLBEING_CONTROL.customMessages];
    expect(messages.length).toBeGreaterThan(0);
    for (const message of messages) {
      expect(CANONICAL_CATEGORIES).toContain(message.category);
      const triggers = 'recommendedTriggers' in message ? message.recommendedTriggers : message.triggers;
      expect(triggers.length).toBeGreaterThan(0);
      for (const trigger of triggers) expect(CANONICAL_TRIGGERS).toContain(trigger);
    }
  });

  it('has no retired parent-web-only value left in the shipped locale copy', () => {
    for (const locale of [en, ar]) {
      const keys = [
        ...Object.keys(locale.wellbeing.categories),
        ...Object.keys(locale.wellbeing.triggerLabels),
      ];
      for (const retired of RETIRED_VALUES) expect(keys).not.toContain(retired);
    }
  });
});
