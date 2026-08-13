import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { useIsOnline } from '../../hooks/useIsOnline';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import type { WebRuleDeliveryStatus, WebRuleEntry, WebRuleListType } from '../../domain/webRulePolicy';
import { describeWebRuleValidationError, validateWebRuleDomain } from '../../domain/webRulePolicy';
import type { WebProtectionStatus } from '../../domain/types';

interface WebProtectionPageData {
  status: WebProtectionStatus;
  rules: WebRuleEntry[];
  deliveryStatus: WebRuleDeliveryStatus;
  revision: number | null;
}

/**
 * doc 33: upgraded from a read-only status card into a real allow/deny-list
 * authoring surface. doc 36: "parent saved != child applied" -- this page
 * only ever claims [WebRuleDeliveryStatus] as reported by
 * [WebRuleAdminClient], never fabricates APPLIED locally. doc 35: the
 * mutation path itself is crypto-gated (RealWebRuleAdminClient) -- in a
 * production, non-demo build this page's add/remove actions will honestly
 * fail with the crypto-review-required message until that gate clears; the
 * dev/demo fixture simulates a full working round trip for UI development.
 */
export default function WebProtectionPage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const online = useIsOnline();

  const { data, loading, error, reload } = useAsync<WebProtectionPageData>(async () => {
    const [status, ruleState] = await Promise.all([
      clients.parentFamilyData.getWebProtection(childId),
      clients.webRuleAdmin.listRules(childId),
    ]);
    return { status, rules: ruleState.rules, deliveryStatus: ruleState.status, revision: ruleState.revision };
  }, [childId]);

  const [newDomain, setNewDomain] = useState('');
  const [newListType, setNewListType] = useState<WebRuleListType>('DENY');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const allowRules = data.rules.filter((r) => r.listType === 'ALLOW');
  const denyRules = data.rules.filter((r) => r.listType === 'DENY');

  const onAdd = async () => {
    const validation = validateWebRuleDomain(newDomain, newListType, data.rules);
    if (!validation.valid || validation.canonicalDomain === null) {
      setFormError(validation.errors.map(describeWebRuleValidationError).join(' '));
      return;
    }
    setFormError(null);
    setMutationError(null);
    if (!online) {
      // doc 37: honest offline draft state -- never pretend the child received it.
      setMutationError(t('webProtection.pendingOffline'));
      return;
    }
    setSubmitting(true);
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () => clients.webRuleAdmin.setRule(childId, validation.canonicalDomain!, newListType));
      setNewDomain('');
      reload();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  const onRemove = async (domain: string, listType: WebRuleListType) => {
    setMutationError(null);
    if (!online) {
      setMutationError(t('webProtection.pendingOffline'));
      return;
    }
    setSubmitting(true);
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () => clients.webRuleAdmin.removeRule(childId, domain, listType));
      reload();
    } catch (e) {
      setMutationError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card-grid">
      <article className="card">
        <h2>{t('nav.webProtection')}</h2>
        <StatusBadge state={data.status.state} />
        <p>{t('webProtection.filteringLevel', { level: data.status.filteringLevel })}</p>
        <p>
          {t('webProtection.deliveryStatus')}: <span className={`web-rule-status web-rule-status-${data.deliveryStatus.toLowerCase()}`}>{t(`webProtection.status.${data.deliveryStatus}`)}</span>
          {data.revision !== null && <span className="web-rule-revision"> ({t('webProtection.revision', { revision: data.revision })})</span>}
        </p>

        {!online && <p role="status" className="field-warning">{t('webProtection.offlineNotice')}</p>}
        {mutationError && <p role="alert" className="field-error">{mutationError}</p>}

        <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
          <div className="field-row">
            <label htmlFor="web-rule-domain">{t('webProtection.addDomainLabel')}</label>
            <input
              id="web-rule-domain"
              type="text"
              value={newDomain}
              placeholder={t('webProtection.addDomainPlaceholder')}
              onChange={(e) => setNewDomain(e.target.value)}
            />
            <select
              aria-label={t('webProtection.listTypeLabel')}
              value={newListType}
              onChange={(e) => setNewListType(e.target.value as WebRuleListType)}
            >
              <option value="DENY">{t('webProtection.listType.DENY')}</option>
              <option value="ALLOW">{t('webProtection.listType.ALLOW')}</option>
            </select>
            <button type="button" className="btn btn-primary" onClick={onAdd} disabled={submitting}>
              {t('webProtection.addButton')}
            </button>
          </div>
          {formError && <p role="alert" className="field-error">{formError}</p>}
        </PermissionGate>

        <h3>{t('webProtection.denylistTitle')}</h3>
        <WebRuleList rules={denyRules} onRemove={(domain) => onRemove(domain, 'DENY')} submitting={submitting} emptyLabel={t('webProtection.denylistEmpty')} />

        <h3>{t('webProtection.allowlistTitle')}</h3>
        <WebRuleList rules={allowRules} onRemove={(domain) => onRemove(domain, 'ALLOW')} submitting={submitting} emptyLabel={t('webProtection.allowlistEmpty')} />
      </article>
    </div>
  );
}

function WebRuleList({
  rules,
  onRemove,
  submitting,
  emptyLabel,
}: {
  rules: WebRuleEntry[];
  onRemove: (domain: string) => void;
  submitting: boolean;
  emptyLabel: string;
}) {
  const { t } = useTranslation();
  if (rules.length === 0) return <p>{emptyLabel}</p>;
  return (
    <ul className="web-rule-list">
      {rules.map((rule) => (
        <li key={rule.domain} className="web-rule-list-item">
          <span>{rule.domain}</span>
          <PermissionGate action="EDIT_CHILD_POLICY">
            <button type="button" className="btn btn-secondary" onClick={() => onRemove(rule.domain)} disabled={submitting}>
              {t('webProtection.removeButton')}
            </button>
          </PermissionGate>
        </li>
      ))}
    </ul>
  );
}
