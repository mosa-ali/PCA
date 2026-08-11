import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPreviewCard } from '../dist/previewModel.js';
import { baseMessage } from './fixtures.mjs';

test('an ordinary IN_APP_SMALL_CARD preview shows the requested language text', () => {
  const card = buildPreviewCard(baseMessage(), 'IN_APP_SMALL_CARD', 'en');
  assert.equal(card.redacted, false);
  assert.equal(card.title, 'Say thanks');
  assert.equal(card.direction, 'ltr');
});

test('LOCK_SCREEN_REDACTED is always redacted regardless of supervision flag', () => {
  const card = buildPreviewCard(baseMessage(), 'LOCK_SCREEN_REDACTED', 'en');
  assert.equal(card.redacted, true);
  assert.equal(card.title, 'Wellbeing reminder');
  assert.equal(card.languageTag, null);
});

test('a supervised message is redacted on STANDARD_NOTIFICATION', () => {
  const message = baseMessage({
    delivery: {
      triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3, repeatCooldownMinutes: 30,
      lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: true,
    },
  });
  const card = buildPreviewCard(message, 'STANDARD_NOTIFICATION', 'en');
  assert.equal(card.redacted, true);
});

test('a supervised message is NOT redacted on IN_APP_SMALL_CARD (an attended-context surface)', () => {
  const message = baseMessage({
    delivery: {
      triggers: ['PERIODIC'], minimumIntervalMinutes: 60, maximumPerDay: 3, repeatCooldownMinutes: 30,
      lockScreenAllowed: false, dismissible: true, snoozable: true, requiresAdultSupervision: true,
    },
  });
  const card = buildPreviewCard(message, 'IN_APP_SMALL_CARD', 'en');
  assert.equal(card.redacted, false);
});

test('an unsupervised message is not redacted on STANDARD_NOTIFICATION', () => {
  const card = buildPreviewCard(baseMessage(), 'STANDARD_NOTIFICATION', 'en');
  assert.equal(card.redacted, false);
});

test('ARABIC_RTL surface forces the Arabic variant and rtl direction', () => {
  const message = baseMessage({
    languageTexts: {
      en: { title: 'Say thanks', body: 'Body' },
      ar: { title: 'قل شكرا', body: 'نص عربي' },
    },
  });
  const card = buildPreviewCard(message, 'ARABIC_RTL');
  assert.equal(card.redacted, false);
  assert.equal(card.title, 'قل شكرا');
  assert.equal(card.direction, 'rtl');
  assert.equal(card.languageTag, 'ar');
});

test('ENGLISH surface forces the English variant and ltr direction', () => {
  const message = baseMessage({
    languageTexts: {
      en: { title: 'Say thanks', body: 'Body' },
      ar: { title: 'قل شكرا', body: 'نص عربي' },
    },
  });
  const card = buildPreviewCard(message, 'ENGLISH');
  assert.equal(card.title, 'Say thanks');
  assert.equal(card.direction, 'ltr');
});

test('requesting a language with no parent-authored translation falls back to a generic redacted preview', () => {
  const card = buildPreviewCard(baseMessage(), 'IN_APP_SMALL_CARD', 'fr');
  assert.equal(card.redacted, true);
  assert.equal(card.title, 'Wellbeing reminder');
});

test('the redacted preview never leaks private message text', () => {
  const message = baseMessage({ languageTexts: { en: { title: 'Private family detail', body: 'Sensitive body text' } } });
  const card = buildPreviewCard(message, 'LOCK_SCREEN_REDACTED', 'en');
  assert.equal(card.title.includes('Private'), false);
  assert.equal(card.body.includes('Sensitive'), false);
});
