import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PermissionGate } from '../../rbac/PermissionGate';

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

interface ProtectionAdministrationPanelProps {
  targets: ProtectionTargetOption[];
  /** Omitted until the coordinator binds the authenticated family routes. */
  actions?: ProtectionAdministrationActions;
}

const FALLBACK_PIN_EXPLANATION = 'Use this local PIN only as an offline fallback when an approved parent-device decision is unavailable. It is never an invitation secret or a server-readable activity credential.';

export default function ProtectionAdministrationPanel({ targets, actions }: ProtectionAdministrationPanelProps) {
  const { t } = useTranslation();
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

  return (
    <section aria-labelledby="protection-administration-title" style={{ marginBlock: '1.5rem' }}>
      <h2 id="protection-administration-title">
        {t('protectionAdministration.title')}
      </h2>
      <p>
        {t('protectionAdministration.intro')}
      </p>
      <p style={{ color: 'var(--color-text-muted)' }}>
        {pinStatus?.offlineFallbackExplanation ?? FALLBACK_PIN_EXPLANATION}
      </p>

      {!actions && (
        <p role="status">
          {t('protectionAdministration.bindingPending')}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}

      <PermissionGate action="DISABLE_PROTECTION_POLICY" showDisabledFallback>
        <fieldset disabled={!actions || busy}>
          <legend>{t('protectionAdministration.pinTitle')}</legend>
          <p>{t('protectionAdministration.pinBody')}</p>
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

      <PermissionGate action="DISABLE_PROTECTION_POLICY" showDisabledFallback>
        <fieldset disabled={!actions || busy || targets.length === 0}>
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

      <h3>{t('protectionAdministration.pendingTitle')}</h3>
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
                  <td data-label={t('protectionAdministration.requestedAt')}>{new Date(approval.requestedAtUtc).toLocaleString()}</td>
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
    </section>
  );
}
