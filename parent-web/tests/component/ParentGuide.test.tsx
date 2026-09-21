import { afterEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import i18n, { applyDocumentDirection } from '../../src/i18n';
import ParentGuide from '../../src/pages/guide/ParentGuide';
import { GUIDE_CATEGORIES } from '../../src/guide/guideTopics';
import { renderWithProviders } from '../utils/renderWithProviders';

describe('Parent Guide', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
    applyDocumentDirection('en');
  });

  it('renders the complete bilingual-ready information architecture and real page links', async () => {
    const { container } = renderWithProviders(<ParentGuide />, { route: '/guide' });

    expect(await screen.findByRole('heading', { name: 'Parent Guide' })).toBeInTheDocument();
    for (const category of GUIDE_CATEGORIES) {
      expect(screen.getAllByRole('heading', { name: i18n.t(category.titleKey) }).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByRole('link', { name: i18n.t('guide.openPage') }).length).toBeGreaterThan(10);
    expect(container.querySelector('a.guide-open-link[href="/dashboard"]')).toBeInTheDocument();
    expect(screen.getByText(i18n.t('guide.topics.recovery.important'))).toBeInTheDocument();
  });

  it('searches the central topic model and links to the authoritative topic anchor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ParentGuide />, { route: '/guide' });

    const search = screen.getByRole('searchbox', { name: i18n.t('guide.searchLabel') });
    await user.type(search, 'recovery');

    expect(screen.getByText(i18n.t('guide.searchResults', { count: 1 }))).toBeInTheDocument();
    const result = screen.getByRole('link', { name: /Recovery/ });
    expect(result).toHaveAttribute('href', '#guide-topic-recovery');

    await user.clear(search);
    await user.type(search, 'does-not-exist');
    expect(screen.getByText(i18n.t('guide.noResults'))).toBeInTheDocument();
  });

  it('renders Arabic guide copy, RTL direction, and Arabic search', async () => {
    await i18n.changeLanguage('ar');
    applyDocumentDirection('ar');
    renderWithProviders(<ParentGuide />, { route: '/guide' });

    expect(screen.getByRole('heading', { name: 'دليل الوالدين' })).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('heading', { name: i18n.t('guide.categories.safetyPrivacy') })).toBeInTheDocument();
    expect(screen.queryByText('Parent Guide')).not.toBeInTheDocument();

    const search = screen.getByRole('searchbox', { name: i18n.t('guide.searchLabel') });
    await userEvent.type(search, 'الاسترداد');
    expect(screen.getByText(i18n.t('guide.searchResults', { count: 1 }))).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /الاسترداد/ })).toHaveAttribute('href', '#guide-topic-recovery');
  });

  it('has no axe violations in the Guide information architecture', async () => {
    const { container } = renderWithProviders(<ParentGuide />, { route: '/guide' });
    expect(await axe(container)).toHaveNoViolations();
  });
});
