/**
 * PCA-DW-W2-15F -- verification/reset email templates. Plain, parameterized
 * functions (no template-engine dependency) producing subject/text/html for
 * the two message kinds ParentAccountService actually sends. Deliberately
 * minimal HTML (no external stylesheet/image/tracking-pixel fetch of any
 * kind -- an email client that blocks remote content must still render
 * this correctly), and the code itself is the ONLY variable content: no
 * other account/family-identifying data is ever interpolated into a
 * message a mail provider, its logs, or any intermediate relay will see.
 */

export type EmailTemplateKind = 'VERIFICATION' | 'PASSWORD_RESET' | 'PLATFORM_ADMIN_ACTIVATION' | 'LOGIN_STEP_UP';

export interface RenderedTemplateContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function renderVerificationCodeTemplate(code: string): RenderedTemplateContent {
  const safeCode = escapeHtml(code);
  return {
    subject: 'Your PCA verification code',
    text: `Your PCA verification code is: ${code}\n\nThis code expires soon and can only be used once. If you did not request this, you can ignore this email.`,
    html: `<p>Your PCA verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeCode}</p><p>This code expires soon and can only be used once. If you did not request this, you can ignore this email.</p>`,
  };
}

export function renderPasswordResetCodeTemplate(code: string): RenderedTemplateContent {
  const safeCode = escapeHtml(code);
  return {
    subject: 'Your PCA password reset code',
    text: `Your PCA password reset code is: ${code}\n\nThis code expires soon and can only be used once. If you did not request a password reset, you can ignore this email -- your password has not been changed.`,
    html: `<p>Your PCA password reset code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeCode}</p><p>This code expires soon and can only be used once. If you did not request a password reset, you can ignore this email -- your password has not been changed.</p>`,
  };
}

export function renderPlatformAdminActivationTemplate(url: string): RenderedTemplateContent {
  const safeUrl = escapeHtml(url);
  return {
    subject: 'Complete your PCA Platform Admin activation',
    text: `Complete your PCA Platform Admin activation by opening this one-time link:\n${url}\n\nThe link expires soon and can only be used once. If you did not expect this message, ignore it.`,
    html: `<p>Complete your PCA Platform Admin activation using this one-time link:</p><p><a href="${safeUrl}">${safeUrl}</a></p><p>The link expires soon and can only be used once. If you did not expect this message, ignore it.</p>`,
  };
}

/**
 * Owner authentication-architecture decision (2026-09-15): the email sent
 * when a normal parent/family login requires the "first successful login"
 * risk-based step-up code -- deliberately distinct wording from both
 * VERIFICATION (registration) and PASSWORD_RESET, so a recipient never
 * confuses "someone is trying to sign in" with "someone is registering" or
 * "someone requested a password reset."
 */
export function renderLoginStepUpCodeTemplate(code: string): RenderedTemplateContent {
  const safeCode = escapeHtml(code);
  return {
    subject: 'Your PCA sign-in verification code',
    text: `Your PCA sign-in verification code is: ${code}\n\nThis code expires soon and can only be used once. If you did not just try to sign in to PCA, you can ignore this email -- your password has not been changed.`,
    html: `<p>Your PCA sign-in verification code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeCode}</p><p>This code expires soon and can only be used once. If you did not just try to sign in to PCA, you can ignore this email -- your password has not been changed.</p>`,
  };
}

export function renderEmailTemplate(kind: EmailTemplateKind, code: string): RenderedTemplateContent {
  if (kind === 'VERIFICATION') return renderVerificationCodeTemplate(code);
  if (kind === 'PASSWORD_RESET') return renderPasswordResetCodeTemplate(code);
  if (kind === 'LOGIN_STEP_UP') return renderLoginStepUpCodeTemplate(code);
  return renderPlatformAdminActivationTemplate(code);
}
