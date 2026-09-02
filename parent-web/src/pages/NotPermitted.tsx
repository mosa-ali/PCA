import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { useCurrentRole } from '../state/AuthContext';
import { evaluatePermission, denialReasonCodeFromKey, nextStepKey, type FamilyAction } from '../domain/roles';

export default function NotPermitted() {
  const { t } = useTranslation();
  const location = useLocation();
  const role = useCurrentRole();
  const state = location.state as { from?: string; reason?: string; action?: string } | null;
  const backTo = state?.from ?? '/dashboard';

  // RouteGuard forwards the English `reason` string it got from
  // evaluatePermission for diagnostics. Re-evaluating the same (role, action)
  // pair here gives the LOCALIZED key for exactly the same denial, so an
  // Arabic parent reads Arabic instead of English developer prose. The raw
  // forwarded string is only used if no action was forwarded to re-evaluate.
  const reEvaluated = state?.action ? evaluatePermission(role, state.action as FamilyAction) : null;
  const denialReasonKey = reEvaluated && !reEvaluated.allowed ? reEvaluated.reasonKey : undefined;
  const localizedReason = denialReasonKey ? t(denialReasonKey) : null;
  const shownReason = localizedReason ?? state?.reason ?? null;

  // "What to do next" is only derivable when we have the structured
  // DenialReasonCode (i.e. a real re-evaluated denial, not just a raw
  // forwarded string) -- never fabricated for the fallback/raw-reason path.
  const denialCode = denialReasonKey ? denialReasonCodeFromKey(denialReasonKey) : null;
  const nextStep = denialCode ? t(nextStepKey(denialCode)) : null;

  return (
    <section aria-labelledby="not-permitted-title" role="alert">
      <h1 id="not-permitted-title">{t('rbac.deniedTitle')}</h1>
      <p>{t('rbac.deniedBody', { role: t(`roles.${role.toLowerCase()}`) })}</p>
      {shownReason && <p style={{ color: 'var(--color-text-muted)' }}>{shownReason}</p>}
      {state?.action && (
        <p style={{ color: 'var(--color-text-muted)' }}>
          {t('rbac.action')}: {t(`rbac.actions.${state.action}`)}
        </p>
      )}
      {nextStep && <p>{nextStep}</p>}
      <Link to={backTo} className="btn">
        {t('common.back')}
      </Link>
    </section>
  );
}
