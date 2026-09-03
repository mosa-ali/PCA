import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionGate } from '../../rbac/PermissionGate';
import { Disclosure } from '../../components/common/Disclosure';
import { formatDateTime } from '../../i18n/formatters';

export type ProtectionApprovalState = 'PARENT_APPROVAL_REQUIRED' | 'KEEP_ACTIVE' | 'TEMPORARILY_DISABLE' | 'ALLOW_REMOVAL';
export type ProtectionDecision = Exclude<ProtectionApprovalState, 'PARENT_APPROVAL_REQUIRED'>;
export type ProtectionDecisionMethod = 'REMOTE_PARENT' | 'LOCAL_ADMINISTRATION_PIN' | 'AUTHORIZED_RECOVERY';

export interface ProtectionTargetOption {
  childId: string;
  childLabel: string;
  deviceId: string;
  deviceLabel: string;
  protectionLevel: 'STANDARD' | 'PROTECTED' | 'DEGRADED' | 'AUTHORIZATION_REQUIRED' | 'NOT_SUPPORTED';
}

export interface ProtectionApprovalView {
  requestId: string;
  childId: string;
  childLabel: string;
  deviceId: string;
  deviceLabel: string;
  requestedAtUtc: string;
  expiresAtUtc: string;
  protectionLevel: ProtectionTargetOption['protectionLevel'];
  reasonCategory: string | null;
  state: ProtectionApprovalState;
}

export interface ProtectionPinStatus {
  configured: boolean;
  minimumRecommendedLength: number;
  offlineFallbackExplanation: string;
  lockedUntilUtc: string | null;
}

/**
 * Coordinator binding for this page. Its implementation must call the
 * family-RBAC and authenticated transport boundaries; the page never treats
 * a hidden button or a caller-supplied role as authorization.
 */
export interface ProtectionAdministrationActions {
  getPinStatus(): Promise<ProtectionPinStatus>;
  configurePin(pin: string): Promise<ProtectionPinStatus>;
  listPendingApprovals(): Promise<ProtectionApprovalView[]>;
  requestApproval(input: {
    childId: string;
    deviceId: string;
    protectionLevel: ProtectionTargetOption['protectionLevel'];
    operation: 'REMOVE_REVOKE_DEVICE' | 'DISABLE_PROTECTION_POLICY';
    reasonCategory: string | null;
  }): Promise<ProtectionApprovalView>;
  decideApproval(input: {
    requestId: string;
    method: ProtectionDecisionMethod;
    decision: ProtectionDecision;
    temporaryDisableUntilUtc?: string | null;
    pin?: string;
  }): Promise<ProtectionApprovalView>;
}

/**
 * Which half of this panel to render.
 *
 * `advanced` is the Administration PIN and nothing else. `protection` is the
 * parent-decision request plus the pending/decided list. They used to render
 * back-to-back inside one `PermissionGate` directly beneath the "Add a child
 * device" form, which is what put a security PIN in the middle of a new
 * parent's first device setup.
 */
export type ProtectionAdministrationSection = 'protection' | 'advanced';

interface ProtectionAdministrationPanelProps {
  section: ProtectionAdministrationSection;
  targets: ProtectionTargetOption[];
  /** Omitted until the coordinator binds the authenticated family routes. */
  actions?: ProtectionAdministrationActions;
}

export default function ProtectionAdministrationPanel({ section, targets, actions }: ProtectionAdministrationPanelProps) {
  const { t, i18n } = useTranslation();
  const [pinStatus, setPinStatus] = useState<ProtectionPinStatus | null>(null);
  const [approvals, setApprovals] = useState<ProtectionApprovalView[]>([]);
  const [pinDraft, setPinDraft] = useState('');
  const [pinConfirmation, setPinConfirmation] = useState('');
  const [selectedTargetId, setSelectedTargetId] = useState('');
  const [operation, setOperation] = useState<'REMOVE_REVOKE_DEVICE' | 'DISABLE_PROTECTION_POLICY'>('REMOVE_REVOKE_DEVICE');
  const [reasonCategory, setReasonCategory] = useState('CHILD_SAFETY_CONCERN');
  const [decision, setDecision] = useState<ProtectionDecision>('KEEP_ACTIVE');
  const [temporaryDisableMinutes, setTemporaryDisableMinutes] = useState('30');
  const [decisionPin, setDecisionPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (selectedTargetId === '' && targets[0]) setSelectedTargetId(targets[0].deviceId);
    if (selectedTargetId !== '' && !targets.some((target) => target.deviceId === selectedTargetId)) {
      setSelectedTargetId(targets[0]?.deviceId ?? '');
    }
  }, [selectedTargetId, targets]);

  useEffect(() => {
    if (!actions) return undefined;
    let cancelled = false;
    setError(null);
    void Promise.all([actions.getPinStatus(), actions.listPendingApprovals()])
      .then(([status, pending]) => {
        if (cancelled) return;
        setPinStatus(status);
        setApprovals(pending);
      })
      .catch(() => {
        if (!cancelled) setError(t('protectionAdministration.errors.load'));
      });
    return () => { cancelled = true; };
  }, [actions, t]);

  const selectedTarget = targets.find((target) => target.deviceId === selectedTargetId) ?? null;

  const configurePin = async () => {
    if (!actions) return;
    setError(null);
    setMessage(null);
    if (!/^\d{6,64}$/.test(pinDraft) || pinDraft !== pinConfirmation) {
      setError(t('protectionAdministration.errors.pinFormat'));
      return;
    }
    setBusy(true);
    try {
      setPinStatus(await actions.configurePin(pinDraft));
      setPinDraft('');
      setPinConfirmation('');
      setMessage(t('protectionAdministration.pinSaved'));
    } catch {
      setError(t('protectionAdministration.errors.savePin'));
    } finally {
      setBusy(false);
    }
  };

  const requestApproval = async () => {
    if (!actions || !selectedTarget) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const created = await actions.requestApproval({
        childId: selectedTarget.childId,
        deviceId: selectedTarget.deviceId,
        protectionLevel: selectedTarget.protectionLevel,
        operation,
        reasonCategory,
      });
      setApprovals((current) => [created, ...current.filter((item) => item.requestId !== created.requestId)]);
      setMessage(t('protectionAdministration.requestCreated'));
    } catch {
      setError(t('protectionAdministration.errors.request'));
    } finally {
      setBusy(false);
    }
  };

  const applyDecision = async (requestId: string, method: ProtectionDecisionMethod) => {
    if (!actions) return;
    setError(null);
    setMessage(null);
    if (method === 'LOCAL_ADMINISTRATION_PIN' && !/^\d{6,64}$/.test(decisionPin)) {
      setError(t('protectionAdministration.errors.decisionPin'));
      return;
    }
    setBusy(true);
    try {
      const updated = await actions.decideApproval({
        requestId,
        method,
        decision,
        ...(decision === 'TEMPORARILY_DISABLE'
          ? { temporaryDisableUntilUtc: new Date(Date.now() + Number(temporaryDisableMinutes) * 60_000).toISOString() }
          : { temporaryDisableUntilUtc: null }),
        ...(method === 'LOCAL_ADMINISTRATION_PIN' ? { pin: decisionPin } : {}),
      });
      setApprovals((current) => current.map((item) => item.requestId === updated.requestId ? updated : item));
      if (method === 'LOCAL_ADMINISTRATION_PIN') setDecisionPin('');
      setMessage(t('protectionAdministration.decisionAccepted'));
    } catch {
      setError(t('protectionAdministration.errors.decision'));
    } finally {
      setBusy(false);
    }
  };

  const announcements = (
    <>
      {!actions && (
        <p role="status">
          {t('protectionAdministration.bindingPending')}
        </p>
      )}
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
    </>
  );

  // ------------------------------------------------------------ the PIN ----
  // Owner requirement: the Administration PIN belongs in advanced/security,
  // NOT in the primary new-device flow.
  //
  // Its real security properties are neither overstated nor understated here.
  // The parent-readable summary says what it IS -- a local backup code used
  // only when a parent's decision cannot reach the device. The precise
  // wording, including the server's own verbatim explanation of the stored
  // verifier, is one click away and unmodified: `offlineFallbackExplanation`
  // arrives from the server and is NOT rewritten. Its previous English-only
  // hardcoded fallback is now an i18n key, so an Arabic parent no longer reads
  // an untranslatable English sentence.
  if (section === 'advanced') {
    // A plain `div`, not a labelled `<section>`: this is a sub-panel inside a
    // section that already carries the landmark name, and a nested region
    // repeating "Administration PIN" only adds landmark noise for a screen
    // reader walking the page.
    return (
      <div className="section-panel">
        <div className="section-panel-head">
          <h3 className="section-panel-title" id="administration-pin-title">
            {t('protectionAdministration.pinTitle')}
          </h3>
        </div>
        <p>{t('protectionAdministration.pinPlainSummary')}</p>
        <Disclosure summary={t('protectionAdministration.pinHowProtected')}>
          <p>{t('protectionAdministration.pinBody')}</p>
          <p>{pinStatus?.offlineFallbackExplanation ?? t('protectionAdministration.pinFallbackExplanation')}</p>
        </Disclosure>

        {announcements}

        <PermissionGate action="DISABLE_PROTECTION_POLICY" showDisabledFallback>
          {/* `min-inline-size: 0` overrides a `<fieldset>`'s UA-default
              `min-inline-size: min-content`, which otherwise refuses to shrink
              below the widest `<option>` and pushed this form 8px past a 320px
              content column. Inline because it is a layout primitive, not a
              design token -- adding a class would mean editing global.css. */}
          <fieldset style={{ minInlineSize: 0 }} disabled={!actions || busy}>
            <legend>{t('protectionAdministration.pinTitle')}</legend>
            <div className="field">
              <label htmlFor="administration-pin">{t('protectionAdministration.pin')}</label>
              <input id="administration-pin" type="password" inputMode="numeric" autoComplete="new-password" maxLength={64} value={pinDraft} onChange={(event) => setPinDraft(event.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="administration-pin-confirm">{t('protectionAdministration.pinConfirm')}</label>
              <input id="administration-pin-confirm" type="password" inputMode="numeric" autoComplete="new-password" maxLength={64} value={pinConfirmation} onChange={(event) => setPinConfirmation(event.target.value)} />
            </div>
            <button type="button" className="btn btn-primary" onClick={() => void configurePin()}>
              {t('protectionAdministration.savePin')}
            </button>
          </fieldset>
        </PermissionGate>
      </div>
    );
  }

  return (
    <div className="section-panel">
      <div className="section-panel-head">
        <h3 className="section-panel-title" id="protection-administration-title">
          {t('protectionAdministration.title')}
        </h3>
      </div>
      <p>
        {t('protectionAdministration.intro')}
      </p>

      {announcements}

      <PermissionGate action="DISABLE_PROTECTION_POLICY" showDisabledFallback>
        <fieldset style={{ minInlineSize: 0 }} disabled={!actions || busy || targets.length === 0}>
          <legend>{t('protectionAdministration.requestTitle')}</legend>
          <div className="field">
            <label htmlFor="protection-target">{t('protectionAdministration.target')}</label>
            <select id="protection-target" value={selectedTargetId} onChange={(event) => setSelectedTargetId(event.target.value)}>
              {targets.length === 0 && <option value="">{t('protectionAdministration.noTargets')}</option>}
              {targets.map((target) => <option key={target.deviceId} value={target.deviceId}>{target.childLabel} — {target.deviceLabel}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="protection-operation">{t('protectionAdministration.operation')}</label>
            <select id="protection-operation" value={operation} onChange={(event) => setOperation(event.target.value as typeof operation)}>
              <option value="REMOVE_REVOKE_DEVICE">{t('protectionAdministration.removeDevice')}</option>
              <option value="DISABLE_PROTECTION_POLICY">{t('protectionAdministration.disableProtection')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="protection-reason">{t('protectionAdministration.reason')}</label>
            <select id="protection-reason" value={reasonCategory} onChange={(event) => setReasonCategory(event.target.value)}>
              <option value="CHILD_SAFETY_CONCERN">{t('protectionAdministration.reasonSafety')}</option>
              <option value="ROUTINE_POLICY_CHANGE">{t('protectionAdministration.reasonPolicy')}</option>
              <option value="DEVICE_LOST_OR_STOLEN">{t('protectionAdministration.reasonLost')}</option>
              <option value="FAMILY_MEMBERSHIP_CHANGE">{t('protectionAdministration.reasonMembership')}</option>
              <option value="RECOVERY">{t('protectionAdministration.reasonRecovery')}</option>
              <option value="OTHER">{t('protectionAdministration.reasonOther')}</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => void requestApproval()}>
            {t('protectionAdministration.request')}
          </button>
        </fieldset>
      </PermissionGate>

      <h4>{t('protectionAdministration.pendingTitle')}</h4>
      {approvals.length === 0 ? (
        <p>{t('protectionAdministration.noRequests')}</p>
      ) : (
        <div className="table-scroll">
          <table className="data-table responsive-cards">
            <thead>
              <tr>
                <th scope="col">{t('protectionAdministration.child')}</th>
                <th scope="col">{t('protectionAdministration.device')}</th>
                <th scope="col">{t('protectionAdministration.requestedAt')}</th>
                <th scope="col">{t('protectionAdministration.protection')}</th>
                <th scope="col">{t('protectionAdministration.reason')}</th>
                <th scope="col">{t('protectionAdministration.state')}</th>
                <th scope="col" aria-label={t('common.actions', { defaultValue: 'Actions' })} />
              </tr>
            </thead>
            <tbody>
              {approvals.map((approval) => (
                <tr key={approval.requestId}>
                  <td data-label={t('protectionAdministration.child')}>{approval.childLabel}</td>
                  <td data-label={t('protectionAdministration.device')}>{approval.deviceLabel}</td>
                  <td data-label={t('protectionAdministration.requestedAt')}>
                    {/* Was `toLocaleString()` with no locale: an Arabic parent
                        got an English date. Formatting now goes through the one
                        module that takes an explicit language. */}
                    <bdi className="iso">{formatDateTime(approval.requestedAtUtc, i18n.language)}</bdi>
                  </td>
                  <td data-label={t('protectionAdministration.protection')}>{approval.protectionLevel}</td>
                  <td data-label={t('protectionAdministration.reason')}>{approval.reasonCategory ?? '—'}</td>
                  <td data-label={t('protectionAdministration.state')}>{approval.state}</td>
                  <td>
                    {approval.state === 'PARENT_APPROVAL_REQUIRED' && (
                      <>
                        <label htmlFor={`decision-${approval.requestId}`} className="visually-hidden">{t('protectionAdministration.decision')}</label>
                        <select id={`decision-${approval.requestId}`} value={decision} onChange={(event) => setDecision(event.target.value as ProtectionDecision)} disabled={!actions || busy}>
                          <option value="KEEP_ACTIVE">{t('protectionAdministration.keepActive')}</option>
                          <option value="TEMPORARILY_DISABLE">{t('protectionAdministration.temporarilyDisable')}</option>
                          <option value="ALLOW_REMOVAL">{t('protectionAdministration.allowRemoval')}</option>
                        </select>
                        {decision === 'TEMPORARILY_DISABLE' && (
                          <label htmlFor={`temporary-disable-minutes-${approval.requestId}`}>
                            {t('protectionAdministration.disableForMinutes')}
                            <input id={`temporary-disable-minutes-${approval.requestId}`} type="number" min={1} max={15} step={1} value={temporaryDisableMinutes} onChange={(event) => setTemporaryDisableMinutes(event.target.value)} disabled={!actions || busy} />
                          </label>
                        )}
                        <input aria-label={t('protectionAdministration.pinForDecision')} type="password" inputMode="numeric" autoComplete="off" maxLength={64} value={decisionPin} onChange={(event) => setDecisionPin(event.target.value)} disabled={!actions || busy} />
                        <button type="button" className="btn" onClick={() => void applyDecision(approval.requestId, 'LOCAL_ADMINISTRATION_PIN')} disabled={!actions || busy}>
                          {t('protectionAdministration.applyPin')}
                        </button>
                        <button type="button" className="btn" onClick={() => void applyDecision(approval.requestId, 'REMOTE_PARENT')} disabled={!actions || busy}>
                          {t('protectionAdministration.applyRemote')}
                        </button>
                        <button type="button" className="btn" onClick={() => void applyDecision(approval.requestId, 'AUTHORIZED_RECOVERY')} disabled={!actions || busy}>
                          {t('protectionAdministration.applyRecovery')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
