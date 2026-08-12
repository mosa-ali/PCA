import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLanguageText } from '../dist/textSafety.js';

test('valid English text produces no issues', () => {
  assert.deepEqual(validateLanguageText('en', 'Say thanks', 'Tell someone thank you today.'), []);
});

test('valid Arabic custom text produces no issues', () => {
  const issues = validateLanguageText('ar', 'قل شكرا', 'أخبر أحد أفراد عائلتك بالشكر اليوم.');
  assert.deepEqual(issues, []);
});

test('blank title and body are rejected', () => {
  const issues = validateLanguageText('en', '   ', '');
  assert.equal(issues.some((i) => i.field === 'title' && i.reason === 'blank'), true);
  assert.equal(issues.some((i) => i.field === 'body' && i.reason === 'blank'), true);
});

test('oversized title and body are rejected', () => {
  const issues = validateLanguageText('en', 'x'.repeat(61), 'y'.repeat(241));
  assert.equal(issues.some((i) => i.field === 'title' && i.reason === 'over-length'), true);
  assert.equal(issues.some((i) => i.field === 'body' && i.reason === 'over-length'), true);
});

test('title/body exactly at the bound is accepted', () => {
  const issues = validateLanguageText('en', 'x'.repeat(60), 'y'.repeat(240));
  assert.equal(issues.some((i) => i.reason === 'over-length'), false);
});

test('control characters are rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'Body text');
  assert.equal(issues.some((i) => i.reason === 'control-characters'), true);
});

// F(medium) correction: the comment above CONTROL_CHAR_PATTERN always said tab/newline/CR are
// rejected, but the implementation previously excluded \x09-\x0D from the class, silently
// allowing them into a small-card title/body. These tests pin that gap closed.
test('a TAB character is rejected', () => {
  const issues = validateLanguageText('en', 'Ti\x09tle', 'Body text');
  assert.equal(issues.some((i) => i.reason === 'control-characters'), true);
});

test('a LF (newline) character is rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'Line one\x0Aline two');
  assert.equal(issues.some((i) => i.reason === 'control-characters'), true);
});

test('a CR (carriage return) character is rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'Line one\x0Dline two');
  assert.equal(issues.some((i) => i.reason === 'control-characters'), true);
});

test('a DEL character is rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'Body\x7Ftext');
  assert.equal(issues.some((i) => i.reason === 'control-characters'), true);
});

test('bidi override abuse is rejected', () => {
  // RLO (U+202E) can be used to visually reverse trailing characters -- a classic filename/text spoofing trick.
  const issues = validateLanguageText('en', 'Reminder‮gnp.exe', 'Body text');
  assert.equal(issues.some((i) => i.reason === 'bidi-override-abuse'), true);
});

test('HTML markup is rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'Click <a href="http://example.com">here</a>');
  assert.equal(issues.some((i) => i.reason === 'html-or-script-markup'), true);
});

test('script injection is rejected', () => {
  const issues = validateLanguageText('en', 'Title', '<script>alert(1)</script>');
  assert.equal(issues.some((i) => i.reason === 'html-or-script-markup'), true);
});

test('javascript: scheme is rejected', () => {
  const issues = validateLanguageText('en', 'Title', 'javascript:alert(1)');
  assert.equal(issues.some((i) => i.reason === 'html-or-script-markup'), true);
});

test('fake OS security alert impersonation is rejected', () => {
  const issues = validateLanguageText('en', 'Security Alert!', 'Your device has been hacked. Call this number immediately.');
  assert.equal(issues.some((i) => i.reason === 'os-security-alert-impersonation'), true);
});
