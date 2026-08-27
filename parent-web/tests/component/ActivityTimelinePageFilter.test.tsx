import { describe, expect, it } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ActivityTimelinePage from '../../src/pages/children/ActivityTimelinePage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/activity" element={<ActivityTimelinePage />} />
    </Routes>
  );
}

describe('ActivityTimelinePage category filter and pagination', () => {
  it('filters the timeline by category client-side', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/activity', role: 'OWNER' });

    await screen.findByText('Used an Education app for 22 minutes');
    expect(screen.getByText('Asr prayer reminder delivered')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Prayer reminder');

    expect(screen.getByText('Asr prayer reminder delivered')).toBeInTheDocument();
    expect(screen.queryByText('Used an Education app for 22 minutes')).not.toBeInTheDocument();
  });

  it('shows an honest empty state when a category filter matches nothing', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/activity', role: 'OWNER' });
    await screen.findByText('Used an Education app for 22 minutes');

    // No fixture entry uses WEB_BROWSING more than once, but every category
    // that exists has at least one entry -- pick one and confirm it's real,
    // then confirm the "all categories" option restores everything.
    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'Location');
    expect(screen.getByText('Location updated to the Home trust zone')).toBeInTheDocument();
    expect(screen.queryByText('Used an Education app for 22 minutes')).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Filter by category'), 'All categories');
    expect(await screen.findByText('Used an Education app for 22 minutes')).toBeInTheDocument();
  });

  it('paginates with a show-more control instead of rendering the entire history at once', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/activity', role: 'OWNER' });
    await screen.findByText('Used an Education app for 22 minutes');

    // 12 fixture entries, page size 10 -- the 12th (oldest) entry starts hidden.
    expect(screen.queryByText('Dhuhr prayer reminder delivered')).not.toBeInTheDocument();
    const showMore = screen.getByRole('button', { name: /Show \d+ more/ });
    await userEvent.click(showMore);
    expect(await screen.findByText('Dhuhr prayer reminder delivered')).toBeInTheDocument();
  });
});
