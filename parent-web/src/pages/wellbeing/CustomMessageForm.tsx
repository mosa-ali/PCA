import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DayOfWeek, WellbeingCategory, WellbeingCustomMessage, WellbeingTrigger } from '../../domain/wellbeing';
import type { ChildSummary } from '../../domain/types';
import { useModalFocusTrap } from '../../hooks/useModalFocusTrap';

const CATEGORIES: WellbeingCategory[] = ['ENCOURAGEMENT', 'BREAK_REMINDER', 'FOCUS', 'GRATITUDE', 'SAFETY_CHECK_IN', 'CUSTOM'];
const TRIGGERS: WellbeingTrigger[] = ['BREAK_DUE', 'CONTINUOUS_USE_WARNING', 'APP_LAUNCH', 'SCHEDULED_TIME_WINDOW', 'LOCK_SCREEN', 'MANUAL'];
const DAYS: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export type DraftMessage = Omit<WellbeingCustomMessage, 'messageId' | 'createdAtUtc' | 'updatedAtUtc'>;

interface CustomMessageFormProps {
  initial: DraftMessage;
  familyChildren: ChildSummary[];
  onCancel: () => void;
  onSave: (draft: DraftMessage) => void;
}

export function CustomMessageForm({ initial, familyChildren, onCancel, onSave }: CustomMessageFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DraftMessage>(initial);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  useModalFocusTrap(dialogRef, true);

  const textFor = (lang: 'en' | 'ar') => draft.languageTexts.find((l) => l.languageTag === lang)?.text ?? '';
  const setText = (lang: 'en' | 'ar', text: string) => {
    const others = draft.languageTexts.filter((l) => l.languageTag !== lang);
    setDraft({ ...draft, languageTexts: [...others, { languageTag: lang, text }] });
  };

  const toggleDay = (day: DayOfWeek) => {
    setDraft((d) => ({
      ...d,
      daysOfWeek: d.daysOfWeek.includes(day) ? d.daysOfWeek.filter((x) => x !== day) : [...d.daysOfWeek, day],
    }));
  };

  const toggleTrigger = (trigger: WellbeingTrigger) => {
    setDraft((d) => ({
      ...d,
      triggers: d.triggers.includes(trigger) ? d.triggers.filter((x) => x !== trigger) : [...d.triggers, trigger],
    }));
  };

  const toggleChild = (childId: string) => {
    setDraft((d) => ({
      ...d,
      targetChildIds: d.targetChildIds.includes(childId)
        ? d.targetChildIds.filter((x) => x !== childId)
        : [...d.targetChildIds, childId],
    }));
  };

  return (
    <div className="modal-overlay" role="presentation" onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby="custom-message-title" style={{ maxWidth: '40rem', maxHeight: '90vh', overflowY: 'auto' }}>
        <h2 id="custom-message-title">{t('wellbeing.createCustom')}</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>{t('wellbeing.privateNote')}</p>

        <div className="field">
          <label htmlFor="text-en">{t('wellbeing.englishText')}</label>
          <textarea ref={firstFieldRef} id="text-en" dir="ltr" value={textFor('en')} onChange={(e) => setText('en', e.target.value)} rows={2} />
        </div>
        <div className="field">
          <label htmlFor="text-ar">{t('wellbeing.arabicText')}</label>
          <textarea id="text-ar" dir="rtl" lang="ar" value={textFor('ar')} onChange={(e) => setText('ar', e.target.value)} rows={2} />
        </div>

        <div className="field">
          <label htmlFor="category">{t('wellbeing.category')}</label>
          <select id="category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value as WellbeingCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`wellbeing.categories.${c}`)}
              </option>
            ))}
          </select>
        </div>

        <fieldset className="field">
          <legend>{t('wellbeing.targetChildren')}</legend>
          {familyChildren.map((c) => (
            <label key={c.childId} className="checkbox-row">
              <input type="checkbox" checked={draft.targetChildIds.includes(c.childId)} onChange={() => toggleChild(c.childId)} />
              {c.displayName}
            </label>
          ))}
        </fieldset>

        <fieldset className="field">
          <legend>{t('wellbeing.triggers')}</legend>
          {TRIGGERS.map((tr) => (
            <label key={tr} className="checkbox-row">
              <input type="checkbox" checked={draft.triggers.includes(tr)} onChange={() => toggleTrigger(tr)} />
              {t(`wellbeing.triggerLabels.${tr}`)}
            </label>
          ))}
        </fieldset>

        <fieldset className="field">
          <legend>{t('wellbeing.days')}</legend>
          {DAYS.map((day) => (
            <label key={day} className="checkbox-row">
              <input type="checkbox" checked={draft.daysOfWeek.includes(day)} onChange={() => toggleDay(day)} />
              {t(`wellbeing.dayNames.${day}`)}
            </label>
          ))}
        </fieldset>

        <div className="field">
          <label htmlFor="start-date">{t('wellbeing.startDate')}</label>
          <input id="start-date" type="date" value={draft.startDate ?? ''} onChange={(e) => setDraft({ ...draft, startDate: e.target.value || null })} />
        </div>
        <div className="field">
          <label htmlFor="end-date">{t('wellbeing.endDate')}</label>
          <input id="end-date" type="date" value={draft.endDate ?? ''} onChange={(e) => setDraft({ ...draft, endDate: e.target.value || null })} />
        </div>

        <div className="field">
          <label htmlFor="min-interval">{t('wellbeing.minimumInterval')}</label>
          <input
            id="min-interval"
            type="number"
            min={0}
            value={draft.minimumIntervalMinutes}
            onChange={(e) => setDraft({ ...draft, minimumIntervalMinutes: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="max-per-day">{t('wellbeing.maximumPerDay')}</label>
          <input
            id="max-per-day"
            type="number"
            min={0}
            value={draft.maximumPerDay}
            onChange={(e) => setDraft({ ...draft, maximumPerDay: Number(e.target.value) })}
          />
        </div>
        <div className="field">
          <label htmlFor="cooldown">{t('wellbeing.repeatCooldown')}</label>
          <input
            id="cooldown"
            type="number"
            min={0}
            value={draft.repeatCooldownMinutes}
            onChange={(e) => setDraft({ ...draft, repeatCooldownMinutes: Number(e.target.value) })}
          />
        </div>

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.lockScreenAllowed}
            onChange={(e) => setDraft({ ...draft, lockScreenAllowed: e.target.checked })}
          />
          {t('wellbeing.lockScreenAllowed')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={draft.dismissible} onChange={(e) => setDraft({ ...draft, dismissible: e.target.checked })} />
          {t('wellbeing.dismissible')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={draft.snoozable} onChange={(e) => setDraft({ ...draft, snoozable: e.target.checked })} />
          {t('wellbeing.snoozable')}
        </label>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.requiresAdultSupervision}
            onChange={(e) => setDraft({ ...draft, requiresAdultSupervision: e.target.checked })}
          />
          {t('wellbeing.requiresSupervision')}
        </label>

        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(draft)}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
