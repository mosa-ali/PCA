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

export type EmailTemplateKind = 'VERIFICATION' | 'PASSWORD_RESET';

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

export function renderEmailTemplate(kind: EmailTemplateKind, code: string): RenderedTemplateContent {
  return kind === 'VERIFICATION' ? renderVerificationCodeTemplate(code) : renderPasswordResetCodeTemplate(code);
}
