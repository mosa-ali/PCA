// THREE THINGS, THREE TREATMENTS.
//
//   nothing here                -> EmptyState       dashed neutral, no role
//   you need to do something /
//     not available yet         -> ActionNeededState blue, role="status",
//                                   one mandatory next step
//   it broke                    -> ErrorState        red, role="alert", retry
//
// Before ActionNeededState existed, ErrorState was the only non-loading,
// non-empty state in the app, so every deliberate fail-closed condition --
// BROWSER_NOT_TRUSTED, the unreviewed crypto gate, a capability that is
// honestly not connected yet -- was rendered under `common.errorTitle`,
// "Something went wrong", with `role="alert"`. In real (non-fixture) mode
// `getDashboard()` always throws one of those by design, so the console
// announced itself as broken at the exact moment it was working correctly.
//
// The honest reason sentences already existed and are unchanged
// (`errors.endpointNotTrusted` and friends). Only the framing moves.
//
// ErrorState's and EmptyState's signatures are PRESERVED: ~30 call sites pass
// `<ErrorState message={error} />` straight from useAsync and must keep
// compiling untouched. Everything here is additive.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  actionNeededPlan,
  actionNeededPlanForMessage,
  describeUserFacingError,
} from '../../i18n/errorMessages';

/* ---------------------------------------------------------------- icons --
   Non-directional by construction: a shield, a circle and an open box have no
   semantic left/right, so none of them mirrors under `dir="rtl"`. All are
   `aria-hidden` -- the heading and body carry the meaning. */

function ShieldKeyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
      <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" strokeLinejoin="round" />
      <circle cx="12" cy="10.5" r="2" />
      <path d="M12 12.5v4M10.75 14.75h2.5" strokeLinecap="round" />
    </svg>
  );
}

function CrossCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" strokeLinecap="round" />
    </svg>
  );
}

function EmptyBoxIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true" focusable="false">
      <path d="M3.5 8.5h17v10a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" strokeLinejoin="round" />
      <path d="M3.5 8.5 6 4h12l2.5 4.5M9.5 12.5h5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------------------------------------------------------------- states -- */

export function LoadingState({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div className="state-block" role="status" aria-live="polite">
      <p>{label ?? t('common.loading')}</p>
    </div>
  );
}

// PCA-NFR-041/045: these headings were `<h3>` unconditionally, which
// broke axe-core's heading-order rule (WCAG 1.3.1) wherever a page renders
// ErrorState/EmptyState directly under its own top-level `<h1>` with no
// intervening `<h2>` (e.g. billing/CheckoutReturn.tsx) -- an h1 -> h3 jump
// with no h2 in between. Found by real axe-core coverage added for
// CheckoutReturn, not a hypothetical. `<h2>` is correct here: every
// existing call site places these directly after the page's own `<h1>`
// (see e.g. billing/DeviceIncreaseRequest.tsx, Settings.tsx has none), so
// this is a pure fix, not a level chosen to paper over one call site while
// breaking another.
export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="state-block state-error" role="alert">
      <span className="state-icon">
        <CrossCircleIcon />
      </span>
      <h2 className="state-title">{t('common.errorTitle')}</h2>
      <p className="state-text">{message ?? t('common.errorGeneric')}</p>
      {onRetry && (
        <button type="button" className="btn state-action" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    // No `role`. An empty state is a fact about the data, not an announcement,
    // and `role="status"` here would interrupt a screen-reader user on every
    // empty list in the app.
    <div className="state-block state-empty">
      <span className="state-icon">
        <EmptyBoxIcon />
      </span>
      <h2 className="state-title">{t('common.emptyTitle')}</h2>
      {message && <p className="state-text">{message}</p>}
    </div>
  );
}

/** The one next step. A route keeps the parent inside the app; never an external URL. */
export interface ActionNeededAction {
  /** i18n key for the button/link label. */
  labelKey: string;
  /** In-app route. */
  to: string;
}

export interface ActionNeededStateProps {
  /** i18n key for the headline. Never `common.errorTitle`. */
  titleKey: string;
  /** i18n key for the plain-language reason -- reuse the existing honest copy. */
  bodyKey?: string;
  /** Already-resolved reason text, when the caller has it rather than a key. */
  body?: string;
  /**
   * The single next step. Omitted ONLY when the condition genuinely has none
   * (e.g. a capability that is not connected to the service yet). If a writer
   * cannot name the step for anything else, the state is wrong -- that is an
   * error, or it is empty.
   */
  action?: ActionNeededAction;
  /** Extra content (a sub-form, a list of children to choose from). */
  children?: ReactNode;
  /** Set false only where the reassurance line would be untrue. */
  showReassurance?: boolean;
}

/**
 * The system is working correctly and has DELIBERATELY declined to show data
 * or claim a capability: BROWSER_NOT_TRUSTED, PAIRING_REQUIRED,
 * NOT_READY_CRYPTO_REVIEW, NOT_IMPLEMENTED, PLATFORM_ENROLLMENT_UNAVAILABLE,
 * MANAGED_DEVICE_LIMIT_REACHED, "no child profile bound yet".
 *
 * Blue and `role="status"`, never red and never `role="alert"`: this is
 * information, not an interruption, and a warning triangle here would tell a
 * parent something is wrong with their family's protection when nothing is.
 */
export function ActionNeededState({
  titleKey,
  bodyKey,
  body,
  action,
  children,
  showReassurance = true,
}: ActionNeededStateProps) {
  const { t } = useTranslation();
  const reason = body ?? (bodyKey ? t(bodyKey) : undefined);
  return (
    <div className="state-block state-action-needed" role="status">
      <span className="state-icon">
        <ShieldKeyIcon />
      </span>
      <h2 className="state-title">{t(titleKey)}</h2>
      {reason && <p className="state-text">{reason}</p>}
      {children}
      {action && (
        <Link className="btn btn-primary state-action" to={action.to}>
          {t(action.labelKey)}
        </Link>
      )}
      {showReassurance && <p className="state-reassurance">{t('states.nothingWasLost')}</p>}
    </div>
  );
}

export interface AsyncStatesProps {
  loading?: boolean;
  /**
   * Either the thrown value (preferred -- `actionNeededPlan` reads its `code`
   * directly) or the already-localized sentence `hooks/useAsync.ts` returns,
   * which is matched back to its key. Anything unrecognised is treated as a
   * genuine failure, which is the safe direction: a real breakage must never
   * be softened into reassuring copy.
   */
  error?: unknown;
  empty?: boolean;
  loadingLabel?: string;
  emptyMessage?: string;
  onRetry?: () => void;
  children?: ReactNode;
}

/**
 * The single place that picks between the four async renderings, so a page
 * never has to re-derive "is this broken, or is this by design?".
 */
export function AsyncStates({
  loading,
  error,
  empty,
  loadingLabel,
  emptyMessage,
  onRetry,
  children,
}: AsyncStatesProps) {
  const { t } = useTranslation();

  if (loading) return <LoadingState label={loadingLabel} />;

  if (error !== null && error !== undefined && error !== false && error !== '') {
    const plan = typeof error === 'string' ? actionNeededPlanForMessage(error, t) : actionNeededPlan(error);
    if (plan) {
      return (
        <ActionNeededState
          titleKey={plan.titleKey}
          bodyKey={plan.bodyKey}
          action={
            plan.actionLabelKey && plan.actionTo
              ? { labelKey: plan.actionLabelKey, to: plan.actionTo }
              : undefined
          }
        />
      );
    }
    return (
      <ErrorState
        message={typeof error === 'string' ? error : describeUserFacingError(error, t)}
        onRetry={onRetry}
      />
    );
  }

  if (empty) return <EmptyState message={emptyMessage} />;

  return <>{children}</>;
}
