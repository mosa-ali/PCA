import type { TFunction } from 'i18next';
import type { ActivityTimelineEntry } from '../domain/activityTimeline';

function translateFixtureTerm(term: string, t: TFunction): string {
  const key = `activityTimeline.summaryTerms.${term}`;
  const translated = t(key);
  return translated === key ? term : translated;
}

/**
 * Activity summaries arrive as category-level, plain-language payloads. Keep
 * English summaries intact for the English console, but translate the known
 * safe summary shapes before they reach an Arabic surface. Unknown payloads
 * use a generic category label rather than leaking an English backend string.
 */
export function localizeActivitySummary(entry: ActivityTimelineEntry, t: TFunction, language: string): string {
  if (!language.toLowerCase().startsWith('ar')) return entry.summary;

  const summary = entry.summary;
  let match = /^Used an? (.+) app for (\d+) minutes$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.appUsage', {
      category: translateFixtureTerm(match[1], t),
      minutes: match[2],
    });
  }

  match = /^Visited a site in the (.+) category$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.webBrowsing', { category: translateFixtureTerm(match[1], t) });
  }

  match = /^A site in the (.+) category was blocked$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.contentBlock', { category: translateFixtureTerm(match[1], t) });
  }

  match = /^Took a (\d+)-minute screen break after continuous use$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.breakSession', { minutes: match[1] });
  }

  if (summary === 'An eye-rest reminder was shown') {
    return t('activityTimeline.summary.eyeProtection');
  }

  match = /^Location updated to the (.+) trust zone$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.location', { zone: translateFixtureTerm(match[1], t) });
  }

  match = /^(.+) prayer reminder delivered$/.exec(summary);
  if (match) {
    return t('activityTimeline.summary.prayerReminder', { prayer: translateFixtureTerm(match[1], t) });
  }

  return t('activityTimeline.summary.unknown', {
    category: t(`activityTimeline.category.${entry.category}`),
  });
}
