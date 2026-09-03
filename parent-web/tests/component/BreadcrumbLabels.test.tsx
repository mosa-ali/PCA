// PCA-FR-111: Breadcrumb built its labels from the URL path
// (`seg.replace(/-/g, ' ')` then title-case), so every breadcrumb on every
// route read as English regardless of locale -- "Trusted Browser", "Screen
// Time", "Web Protection". Segments now resolve through i18n keys, and a
// dynamic segment (a childId, an invoiceId) is shown verbatim rather than
// word-cased into fake English.
import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import { Breadcrumb } from '../../src/components/shell/Breadcrumb';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Breadcrumb labels', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders translated English labels for static route segments', async () => {
    renderWithProviders(<Breadcrumb />, { route: '/security/trusted-browser' });
    const nav = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(nav).toHaveTextContent('Security');
    expect(nav).toHaveTextContent('Trusted Browser');
  });

  it('renders Arabic labels under the Arabic locale instead of the URL words', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<Breadcrumb />, { route: '/security/trusted-browser' });
    const nav = await screen.findByRole('navigation', { name: i18n.t('shell.breadcrumbNav') });

    expect(nav).toHaveTextContent(i18n.t('nav.security'));
    expect(nav).toHaveTextContent(i18n.t('nav.trustedBrowser'));
    expect(nav).not.toHaveTextContent('Trusted Browser');
    expect(nav).not.toHaveTextContent('Security');
  });

  it('translates a deep child route and leaves the dynamic id segment verbatim', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<Breadcrumb />, { route: '/children/child-amir/screen-time' });
    const nav = await screen.findByRole('navigation', { name: i18n.t('shell.breadcrumbNav') });

    expect(nav).toHaveTextContent(i18n.t('nav.children'));
    expect(nav).toHaveTextContent(i18n.t('nav.screenTime'));
    // The id is not a translatable word and must not be turned into "Child Amir".
    expect(nav).toHaveTextContent('child-amir');
    expect(nav).not.toHaveTextContent('Child Amir');
    expect(nav).not.toHaveTextContent('Screen Time');
  });
});

// PPR-2 IA: the new routes bring new static URL segments. A segment missing
// from SEGMENT_LABEL_KEYS silently renders the raw URL word -- in English, to
// an Arabic parent -- so each one is pinned here.
describe('Breadcrumb labels for the new information architecture', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it.each([
    ['/privacy', ['nav.dataPrivacy']],
    ['/safety/alerts', ['nav.groupSafetyPrivacy', 'nav.alerts']],
    ['/protection/screen-time', ['nav.groupProtection', 'nav.screenTime']],
    ['/protection/apps-web', ['nav.groupProtection', 'nav.appsWeb']],
    ['/protection/schedules', ['nav.groupProtection', 'nav.schedules']],
    ['/wellbeing-messages', ['nav.wellbeingMessages']],
  ] as const)('translates every segment of %s in Arabic rather than leaving the URL word', async (route, keys) => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');

    renderWithProviders(<Breadcrumb />, { route });
    const nav = await screen.findByRole('navigation', { name: i18n.t('shell.breadcrumbNav') });

    for (const key of keys) {
      expect(nav).toHaveTextContent(i18n.t(key));
    }
    // No raw URL word survived into the trail.
    for (const segment of route.split('/').filter(Boolean)) {
      expect(nav).not.toHaveTextContent(segment);
    }
  });
});
