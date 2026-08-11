import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { StatusBadge } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';

export default function ScreenTimePage() {
  const { t } = useTranslation();
  const { childId = '' } = useParams();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data, loading, error, reload } = useAsync(() => clients.parentFamilyData.getScreenTime(childId), [childId]);
  const [saving, setSaving] = useState(false);
  const [limit, setLimit] = useState<number | null>(null);
  const [breakMin, setBreakMin] = useState<number | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const effectiveLimit = limit ?? data.continuousUseLimitMinutes;
  const effectiveBreak = breakMin ?? data.breakDurationMinutes;

  const onSave = async () => {
    setSaving(true);
    try {
      await runFamilyAction('EDIT_CHILD_POLICY', () =>
        clients.parentFamilyData.updateScreenTime(childId, {
          continuousUseLimitMinutes: effectiveLimit,
          breakDurationMinutes: effectiveBreak,
        }),
      );
      reload();
    } catch {
      // dev-stub: surfaced via disabled/denied state elsewhere; silent no-op catch here
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card">
      <p>
        {t('dashboard.screenTime')}: <StatusBadge state={data.state} /> ({data.continuousUseElapsedMinutes}m /{' '}
        {data.continuousUseLimitMinutes}m)
      </p>
      <div className="field">
        <label htmlFor="limit">Continuous-use limit (minutes)</label>
        <input
          id="limit"
          type="number"
          min={15}
          max={180}
          value={effectiveLimit}
          disabled={!!error}
          onChange={(e) => setLimit(Number(e.target.value))}
        />
      </div>
      <div className="field">
        <label htmlFor="break">Break duration (minutes)</label>
        <input
          id="break"
          type="number"
          min={5}
          max={90}
          value={effectiveBreak}
          onChange={(e) => setBreakMin(Number(e.target.value))}
        />
      </div>
      <PermissionGate action="EDIT_CHILD_POLICY" showDisabledFallback>
        <button type="button" className="btn btn-primary" onClick={onSave} disabled={saving}>
          {t('common.save')}
        </button>
      </PermissionGate>
    </div>
  );
}
