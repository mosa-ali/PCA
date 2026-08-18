import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import YouTubePage from '../../src/pages/children/YouTubePage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/youtube" element={<YouTubePage />} />
    </Routes>
  );
}

describe('YouTube safe-content capability', () => {
  it('renders Restricted Mode as unavailable instead of inferring it from age or usage', async () => {
    renderWithProviders(<TestApp />, {
      route: '/children/child-amir/youtube',
      role: 'OWNER',
    });

    expect(await screen.findByText('Restricted mode: Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Restricted mode: Yes')).not.toBeInTheDocument();
    expect(screen.queryByText('Restricted mode: No')).not.toBeInTheDocument();
  });
});
