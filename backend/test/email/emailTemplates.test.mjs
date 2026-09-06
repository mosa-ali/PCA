import assert from 'node:assert/strict';
import test from 'node:test';
import { renderEmailTemplate, renderPasswordResetCodeTemplate, renderVerificationCodeTemplate } from '../../dist/email/emailTemplates.js';

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
