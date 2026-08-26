import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../api/client';
import { useAsync } from '../../hooks/useAsync';
import { LoadingState, ErrorState } from '../../components/common/States';
import { PermissionGate } from '../../rbac/PermissionGate';
import { useFamilyAction } from '../../rbac/useFamilyAction';
import { MessagePreview } from '../../components/wellbeing/MessagePreview';
import { CustomMessageForm, type DraftMessage } from './CustomMessageForm';
import type { PreviewSurface } from '../../domain/wellbeing';

const SURFACES: { value: PreviewSurface; labelKey: string }[] = [
  { value: 'IN_APP_CARD', labelKey: 'wellbeing.surfaceInAppCard' },
  { value: 'STANDARD_NOTIFICATION', labelKey: 'wellbeing.surfaceNotification' },
  { value: 'LOCK_SCREEN_REDACTED', labelKey: 'wellbeing.surfaceLockScreen' },
  { value: 'MOBILE_VIEWPORT', labelKey: 'wellbeing.surfaceMobile' },
];

const BLANK_DRAFT: DraftMessage = {
  sourceCuratedId: null,
  languageTexts: [
    { languageTag: 'en', text: '' },
    { languageTag: 'ar', text: '' },
  ],
  category: 'ENCOURAGEMENT',
  enabled: true,
  archived: false,
  startDate: null,
  endDate: null,
  daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
  timeWindows: [],
  triggers: ['APP_LAUNCH'],
  minimumIntervalMinutes: 60,
  maximumPerDay: 3,
  repeatCooldownMinutes: 1440,
  lockScreenAllowed: false,
  dismissible: true,
  snoozable: true,
  requiresAdultSupervision: false,
  targetChildIds: [],
};

export default function WellbeingAdmin() {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();
  const runFamilyAction = useFamilyAction();
  const { data: control, loading, error, reload } = useAsync(() => clients.wellbeingMessages.getControl(), []);
  const { data: curated } = useAsync(() => clients.wellbeingMessages.listCuratedSuggestions(), []);
  const { data: dashboard } = useAsync(() => clients.parentFamilyData.getDashboard(), []);
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [previewText, setPreviewText] = useState<{ text: string; lang: 'en' | 'ar' } | null>(null);
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>('IN_APP_CARD');
  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  if (loading) return <LoadingState />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!control) return null;

  const filteredCurated = categoryFilter ? (curated ?? []).filter((c) => c.category === categoryFilter) : curated ?? [];

  const describeActionFailure = (err: unknown): string =>
    err instanceof Error ? err.message : t('requestsPage.actionErrorFallback');

  const toggleCurated = async (curatedId: string, enabled: boolean) => {
    setActionError(null);
    try {
      await runFamilyAction('MANAGE_WELLBEING_MESSAGES', () => clients.wellbeingMessages.setCuratedSuggestionEnabled(curatedId, enabled));
      reload();
    } catch (err) {
      setActionError(describeActionFailure(err));
    }
  };

  const duplicate = async (curatedId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('MANAGE_WELLBEING_MESSAGES', () => clients.wellbeingMessages.duplicateCurated(curatedId));
      reload();
    } catch (err) {
      setActionError(describeActionFailure(err));
    }
  };

  const archive = async (messageId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('MANAGE_WELLBEING_MESSAGES', () => clients.wellbeingMessages.archiveCustomMessage(messageId));
      reload();
    } catch (err) {
      setActionError(describeActionFailure(err));
    }
  };

  const restore = async (messageId: string) => {
    setActionError(null);
    try {
      await runFamilyAction('MANAGE_WELLBEING_MESSAGES', () => clients.wellbeingMessages.restoreCustomMessage(messageId));
      reload();
    } catch (err) {
      setActionError(describeActionFailure(err));
    }
  };

  const saveDraft = async (draft: DraftMessage) => {
    setFormError(null);
    try {
      await runFamilyAction('MANAGE_WELLBEING_MESSAGES', () =>
        editing ? clients.wellbeingMessages.updateCustomMessage(editing, draft) : clients.wellbeingMessages.createCustomMessage(draft),
      );
      setFormOpen(false);
      setEditing(null);
      reload();
    } catch (err) {
      setFormError(describeActionFailure(err));
      // Keep the form open so the parent's in-progress draft is not lost.
    }
  };

  const active = control.customMessages.filter((m) => !m.archived);
  const archived = control.customMessages.filter((m) => m.archived);

  return (
    <section aria-labelledby="wellbeing-title">
      <h1 id="wellbeing-title">{t('wellbeing.title')}</h1>
      <p className="card">{t('wellbeing.privateNote')}</p>
      <p className="card">{t('wellbeing.noFullScreenNote')}</p>
      {actionError && (
        <p role="alert" className="field-error">
          {actionError}
        </p>
      )}

      <h2>{t('wellbeing.curated')}</h2>
      <div className="field">
        <label htmlFor="cat-filter">{t('wellbeing.category')}</label>
        <select id="cat-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
          <option value="">{t('wellbeing.allCategories')}</option>
          <option value="ENCOURAGEMENT">{t('wellbeing.categories.ENCOURAGEMENT')}</option>
          <option value="BREAK_REMINDER">{t('wellbeing.categories.BREAK_REMINDER')}</option>
          <option value="SAFETY_CHECK_IN">{t('wellbeing.categories.SAFETY_CHECK_IN')}</option>
        </select>
      </div>
      <div className="card-grid">
        {filteredCurated.map((c) => {
          const lang = i18n.language.split('-')[0] as 'en' | 'ar';
          const text = c.languageTexts.find((l) => l.languageTag === lang)?.text ?? c.languageTexts[0]?.text ?? '';
          const enabled = control.selectedCuratedSuggestionIds.includes(c.curatedId);
          return (
            <article className="card" key={c.curatedId}>
              <h3>{t(`wellbeing.categories.${c.category}`)}</h3>
              <p>{text}</p>
              {c.requiresAdultSupervision && <p role="note">{t('wellbeing.supervisionNote')}</p>}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
                  <button type="button" className="btn" onClick={() => toggleCurated(c.curatedId, !enabled)}>
                    {enabled ? t('common.disable') : t('common.enable')}
                  </button>
                </PermissionGate>
                <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
                  <button type="button" className="btn" onClick={() => duplicate(c.curatedId)}>
                    {t('common.duplicate')}
                  </button>
                </PermissionGate>
                <button type="button" className="btn" onClick={() => setPreviewText({ text, lang })}>
                  {t('common.preview')}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      <h2>{t('wellbeing.custom')}</h2>
      <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          {t('wellbeing.createCustom')}
        </button>
      </PermissionGate>
      <div className="card-grid">
        {active.map((m) => {
          const lang = i18n.language.split('-')[0] as 'en' | 'ar';
          const text = m.languageTexts.find((l) => l.languageTag === lang)?.text ?? m.languageTexts[0]?.text ?? '';
          return (
            <article className="card" key={m.messageId}>
              <h3>{t(`wellbeing.categories.${m.category}`)}</h3>
              <p>
                <bdi className="iso">{text}</bdi>
              </p>
              {m.requiresAdultSupervision && <p role="note">{t('wellbeing.supervisionNote')}</p>}
              <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setEditing(m.messageId);
                      setFormOpen(true);
                    }}
                  >
                    {t('common.edit')}
                  </button>
                </PermissionGate>
                <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
                  <button type="button" className="btn" onClick={() => archive(m.messageId)}>
                    {t('common.archive')}
                  </button>
                </PermissionGate>
                <button type="button" className="btn" onClick={() => setPreviewText({ text, lang })}>
                  {t('common.preview')}
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {archived.length > 0 && (
        <>
          <h2>{t('wellbeing.archived')}</h2>
          <div className="card-grid">
            {archived.map((m) => (
              <article className="card" key={m.messageId}>
                <h3>{t(`wellbeing.categories.${m.category}`)}</h3>
                <PermissionGate action="MANAGE_WELLBEING_MESSAGES" showDisabledFallback>
                  <button type="button" className="btn" onClick={() => restore(m.messageId)}>
                    {t('common.restore')}
                  </button>
                </PermissionGate>
              </article>
            ))}
          </div>
        </>
      )}

      {previewText && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <h2>{t('wellbeing.previewSimulator')}</h2>
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBlockEnd: '0.75rem' }}>
            {SURFACES.map((s) => (
              <button
                key={s.value}
                type="button"
                className="btn"
                aria-pressed={previewSurface === s.value}
                onClick={() => setPreviewSurface(s.value)}
              >
                {t(s.labelKey)}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <MessagePreview text={previewText.text} languageTag="en" surface={previewSurface} />
            <MessagePreview text={previewText.text} languageTag="ar" surface={previewSurface} />
          </div>
        </div>
      )}

      {formOpen && (
        <CustomMessageForm
          initial={
            editing
              ? (() => {
                  const m = control.customMessages.find((x) => x.messageId === editing);
                  return m ? { ...m } : BLANK_DRAFT;
                })()
              : BLANK_DRAFT
          }
          familyChildren={dashboard?.children ?? []}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
            setFormError(null);
          }}
          onSave={saveDraft}
          error={formError}
        />
      )}
    </section>
  );
}
