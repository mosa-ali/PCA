import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import LocationPage from '../../src/pages/children/LocationPage';
import { renderWithProviders } from '../utils/renderWithProviders';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/location" element={<LocationPage />} />
    </Routes>
  );
}

// The Safe Zone authoring flow is real end-to-end EXCEPT the family-crypto
// encryption boundary, which is deliberately unavailable in every mode
// (production and this dev fixture alike -- see UnavailableSafeZonePolicyAuthoring
// in api/client.ts) until a reviewed family-crypto adapter exists. These
// tests confirm the honest not-ready path, never a fabricated success.
//
// The empty-state text is the FIRST thing these tests wait on, and it only
// renders after a two-stage async chain settles (resolve familyId, then
// fetch the zone list -- see LocationPage.tsx's two chained useAsync calls).
// That second stage can re-render once its dependency array's familyId
// value settles, orphaning a DOM node `findByText` already resolved to --
// `expect(await findByText(...)).toBeInTheDocument()` holds a single element
// reference, so it can intermittently fail with "element could not be found"
// even though the SAME text is genuinely on screen a moment later, under a
// NEW node. `waitFor` re-queries the DOM fresh on every poll instead of
// holding a stale reference, which is immune to that class of remount.
const INITIAL_LOAD_TIMEOUT_MS = 10_000;

describe('LocationPage Safe Zone authoring', () => {
  it('shows the empty state when no safe zone is configured for this child', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/location', role: 'OWNER' });
    await waitFor(() => expect(screen.getByText('No safe zone is configured for this child.')).toBeInTheDocument(), {
      timeout: INITIAL_LOAD_TIMEOUT_MS,
    });
  });

  it('rejects an invalid definition client-side without attempting to save it', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/location', role: 'OWNER' });
    await screen.findByRole('button', { name: 'Create safe zone' });

    // Label left blank, coordinates/radius left blank -- an invalid definition.
    await userEvent.click(screen.getByRole('button', { name: 'Create safe zone' }));

    expect(await screen.findByText('Check the label, coordinates, and radius -- one of these values is not valid.')).toBeInTheDocument();
  });

  it('an authorized OWNER attempting to create a valid safe zone gets the honest encryption-unavailable state, never a fabricated success', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/location', role: 'OWNER' });
    await screen.findByRole('button', { name: 'Create safe zone' });

    await userEvent.type(screen.getByLabelText('Zone label'), 'Home');
    await userEvent.type(screen.getByLabelText('Latitude'), '24.7');
    await userEvent.type(screen.getByLabelText('Longitude'), '46.6');
    await userEvent.type(screen.getByLabelText('Radius in meters'), '200');
    await userEvent.click(screen.getByRole('button', { name: 'Create safe zone' }));

    await waitFor(() =>
      expect(
        screen.getByText('Safe-zone authoring is locked until this browser can create and verify the family-encrypted policy envelope. No readable location policy is sent to PCA.'),
      ).toBeInTheDocument(),
    );
    // A failed create must never look like a success: the empty state remains.
    expect(screen.getByText('No safe zone is configured for this child.')).toBeInTheDocument();
  });

  it('a VIEWER sees the create form disabled rather than able to submit', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/location', role: 'VIEWER' });
    await waitFor(() => expect(screen.getByText('No safe zone is configured for this child.')).toBeInTheDocument(), {
      timeout: INITIAL_LOAD_TIMEOUT_MS,
    });
    expect(screen.queryByRole('button', { name: 'Create safe zone' })).not.toBeInTheDocument();
  });
});
