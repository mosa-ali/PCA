import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmailTemplate, renderPasswordResetCodeTemplate, renderSecurityNoticeTemplate, renderVerificationCodeTemplate } from '../../dist/email/emailTemplates.js';

test('renderVerificationCodeTemplate includes the code in subject-adjacent text and html, and mentions single-use/expiry', () => {
  const rendered = renderVerificationCodeTemplate('123456');
  assert.match(rendered.text, /123456/);
  assert.match(rendered.html, /123456/);
  assert.match(rendered.text, /expires/i);
  assert.match(rendered.subject, /verification/i);
});

test('renderPasswordResetCodeTemplate includes the code and a "did not request" reassurance', () => {
  const rendered = renderPasswordResetCodeTemplate('654321');
  assert.match(rendered.text, /654321/);
  assert.match(rendered.html, /654321/);
  assert.match(rendered.text, /did not request/i);
  assert.match(rendered.subject, /reset/i);
});

test('renderEmailTemplate dispatches on kind correctly', () => {
  assert.deepEqual(renderEmailTemplate('VERIFICATION', '111111'), renderVerificationCodeTemplate('111111'));
  assert.deepEqual(renderEmailTemplate('PASSWORD_RESET', '222222'), renderPasswordResetCodeTemplate('222222'));
});

test('the code is the ONLY variable content -- no account/family-identifying data ever appears', () => {
  const rendered = renderVerificationCodeTemplate('999999');
  assert.equal(/@/.test(rendered.text), false, 'must never embed an email address');
  assert.equal(/@/.test(rendered.html), false, 'must never embed an email address');
});

test('html output has no remote content of any kind (no <img>, <script>, external stylesheet, or tracking pixel)', () => {
  const rendered = renderVerificationCodeTemplate('123456');
  assert.equal(/<img|<script|href=|src=/i.test(rendered.html), false);
});

test('successful-login notice names the event and UTC time without factor, secret, device, or location details', () => {
  const rendered = renderSecurityNoticeTemplate('LOGIN_SUCCESSFUL', '2026-09-26T12:34:56.000Z');
  assert.match(rendered.subject, /successful sign-in/i);
  assert.match(rendered.text, /successful sign-in/i);
  assert.match(rendered.text, /2026-09-26 12:34 UTC/);
  assert.match(rendered.text, /reset your PCA password/i);
  assert.doesNotMatch(`${rendered.subject}\n${rendered.text}\n${rendered.html}`, /@|123456|totp|device|location/i);
});

test('MFA recovery and password reset notices describe immediate revocation without advertising a hold or removing TOTP on password reset', () => {
  const recovery = renderSecurityNoticeTemplate('MFA_RESET', '2026-10-01T12:34:56.000Z');
  assert.match(recovery.text, /previous authenticator was removed/i);
  assert.match(recovery.text, /all existing Parent sessions.*signed out/i);
  assert.match(recovery.text, /set up a replacement authenticator immediately/i);
  assert.doesNotMatch(recovery.text, /24.hour|wait until|hold ends/i);

  const password = renderSecurityNoticeTemplate('PASSWORD_CHANGED', '2026-10-01T12:34:56.000Z');
  assert.match(password.text, /all existing sessions.*signed out/i);
  assert.match(password.text, /new password and authenticator/i);
});
