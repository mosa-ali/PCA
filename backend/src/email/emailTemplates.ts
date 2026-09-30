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

export type EmailTemplateKind =
  | 'VERIFICATION'
  | 'PASSWORD_RESET'
  | 'PLATFORM_ADMIN_ACTIVATION'
  | 'LOGIN_STEP_UP'
  | 'MFA_RECOVERY'
  | 'ACCOUNT_ACTIVATED'
  | 'FIRST_LOGIN'
  | 'LOGIN_SUCCESSFUL'
  | 'MFA_ENROLLED'
  | 'MFA_RESET'
  | 'MFA_RECOVERY_PENDING'
  | 'PASSWORD_CHANGED';

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

export function renderMfaRecoveryCodeTemplate(code: string): RenderedTemplateContent {
  const safeCode = escapeHtml(code);
  return {
    subject: 'Your PCA authenticator recovery code',
    text: `Someone asked to recover access to a PCA Parent account because the authenticator app is unavailable. Your recovery code is: ${code}\n\nThis code expires soon and can only be used once. If you submit it, all Parent sessions and trusted-browser access will be signed out. You can immediately set up a replacement authenticator. If you did not ask for this, do not share the code -- contact PCA support immediately to secure your account.`,
    html: `<p>Someone asked to recover access to a PCA Parent account because the authenticator app is unavailable. Your recovery code is:</p><p style="font-size:24px;font-weight:bold;letter-spacing:4px;">${safeCode}</p><p>This code expires soon and can only be used once. If you submit it, all Parent sessions and trusted-browser access will be signed out. You can immediately set up a replacement authenticator.</p><p>If you did not ask for this, do not share the code -- contact PCA support immediately to secure your account.</p>`,
  };
}

export type SecurityNoticeKind = 'ACCOUNT_ACTIVATED' | 'FIRST_LOGIN' | 'LOGIN_SUCCESSFUL' | 'MFA_ENROLLED' | 'MFA_RESET' | 'MFA_RECOVERY_PENDING' | 'PASSWORD_CHANGED';

/** Formats the event instant; anything that is not a plain ISO-8601 UTC instant renders as "recently" rather than being echoed. */
function formatNoticeInstant(occurredAtIso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}):\d{2}(?:\.\d+)?Z$/.exec(occurredAtIso);
  return match ? `${match[1]} ${match[2]} UTC` : 'recently';
}

/** A security notice's only variable is the UTC instant of the event -- never a code, secret, device name or location. */
function renderNotice(subject: string, lines: readonly string[], occurredAtIso: string): RenderedTemplateContent {
  const body = [...lines, `Time: ${formatNoticeInstant(occurredAtIso)}`, 'If this was not you, reset your PCA password immediately and contact PCA support.'];
  return {
    subject,
    text: body.join('\n\n'),
    html: body.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
  };
}

export function renderSecurityNoticeTemplate(kind: SecurityNoticeKind, occurredAtIso: string): RenderedTemplateContent {
  if (kind === 'MFA_RECOVERY_PENDING') {
    return renderNotice('A request was made to recover your authenticator', [
      'A request was made to recover your authenticator. All Parent sessions were signed out. Verify the recovery code and set up a replacement authenticator as soon as verification succeeds.',
      'If you did not request this, contact PCA support immediately to secure your account.',
    ], occurredAtIso);
  }
  if (kind === 'ACCOUNT_ACTIVATED') {
    return renderNotice('Your PCA Parent account is active', [
      'Your email address is verified and your PCA Parent account is now active. You can sign in to the Parent Console.',
      'After your first sign-in you will be asked to protect the account with an authenticator app (for example Microsoft Authenticator or Google Authenticator; no Microsoft or Google account is needed). You can postpone this for up to 3 days after that first sign-in; after that, setting it up is required to continue.',
    ], occurredAtIso);
  }
  if (kind === 'FIRST_LOGIN') {
    return renderNotice('First sign-in to your PCA Parent account', ['A first login to your PCA Parent account was completed.'], occurredAtIso);
  }
  if (kind === 'LOGIN_SUCCESSFUL') {
    return renderNotice('Successful sign-in to your PCA Parent account', ['A successful sign-in to your PCA Parent account was completed. If this was not you, reset your password and contact PCA support.'], occurredAtIso);
  }
  if (kind === 'MFA_ENROLLED') {
    return renderNotice('Authenticator app added to your PCA Parent account', [
      'An authenticator app now protects your PCA Parent account. Every sign-in will ask for a 6-digit code from that app.',
    ], occurredAtIso);
  }
  if (kind === 'PASSWORD_CHANGED') {
    return renderNotice('Your PCA Parent password was reset', [
      'Your PCA Parent password was reset. All existing sessions and trusted-browser access were signed out. Sign in again with your new password and authenticator.',
    ], occurredAtIso);
  }
  return renderNotice('Authenticator removed from your PCA Parent account', [
    'Your previous authenticator was removed after an emailed recovery code was confirmed. All existing Parent sessions and trusted-browser access were signed out. You can set up a replacement authenticator immediately.',
  ], occurredAtIso);
}

export function renderEmailTemplate(kind: EmailTemplateKind, code: string): RenderedTemplateContent {
  if (kind === 'VERIFICATION') return renderVerificationCodeTemplate(code);
  if (kind === 'PASSWORD_RESET') return renderPasswordResetCodeTemplate(code);
  if (kind === 'LOGIN_STEP_UP') return renderLoginStepUpCodeTemplate(code);
  if (kind === 'MFA_RECOVERY') return renderMfaRecoveryCodeTemplate(code);
  if (kind === 'ACCOUNT_ACTIVATED' || kind === 'FIRST_LOGIN' || kind === 'LOGIN_SUCCESSFUL' || kind === 'MFA_ENROLLED' || kind === 'MFA_RESET' || kind === 'MFA_RECOVERY_PENDING' || kind === 'PASSWORD_CHANGED') return renderSecurityNoticeTemplate(kind, code);
  return renderPlatformAdminActivationTemplate(code);
}
