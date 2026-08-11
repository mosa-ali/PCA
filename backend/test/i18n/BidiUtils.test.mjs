import assert from 'node:assert/strict';
import test from 'node:test';
import { isolateLtr, sanitizeBidiControls } from '../../dist/i18n/BidiUtils.js';

test('isolateLtr wraps a token in FSI/PDI, never an override character', () => {
  const isolated = isolateLtr('example.com');
  assert.equal(isolated, '⁦example.com⁩');
  assert.ok(!isolated.includes('‭'));
  assert.ok(!isolated.includes('‮'));
});

test('isolateLtr handles an email address', () => {
  assert.equal(isolateLtr('parent@example.com'), '⁦parent@example.com⁩');
});

test('isolateLtr handles a UTC offset token', () => {
  assert.equal(isolateLtr('UTC+03:00'), '⁦UTC+03:00⁩');
});

test('sanitizeBidiControls strips a hostile RLO override', () => {
  const hostile = 'safe‮dnuoccadesab-fdp.exe';
  assert.equal(sanitizeBidiControls(hostile), 'safednuoccadesab-fdp.exe');
});

test('sanitizeBidiControls strips every known bidi control character', () => {
  const controls = '‎‏‪‫‬‭‮⁦⁧⁨⁩';
  assert.equal(sanitizeBidiControls(`a${controls}b`), 'ab');
});

test('sanitizeBidiControls leaves ordinary Arabic and Latin text untouched', () => {
  const text = 'تم حظر example.com في 2026-08-10، الساعة 18:30 (UTC+03:00)';
  assert.equal(sanitizeBidiControls(text), text);
});
