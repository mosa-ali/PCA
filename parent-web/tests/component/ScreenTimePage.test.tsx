import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import ScreenTimePage from '../../src/pages/children/ScreenTimePage';
import { renderWithProviders } from '../utils/renderWithProviders';
import { DEV_SCREEN_TIME } from '../../src/api/dev/fixtures';
import type { ScreenTimeStatus } from '../../src/domain/types';

function TestApp() {
  return (
    <Routes>
      <Route path="/children/:childId/screen-time" element={<ScreenTimePage />} />
    </Routes>
  );
}

describe('ScreenTimePage policy-status wiring', () => {
  it('shows no policy-status badge before any save has been made', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
    expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
  });

  it('performing a real save transitions the visible PolicyStatusBadge to PENDING_DELIVERY, never APPLIED', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const saveButton = await screen.findByRole('button', { name: 'Save' });

    await userEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText('Queued -- pending delivery')).toBeInTheDocument());
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('shows PENDING_DELIVERY together with the child-offline notice when the target device is offline -- never APPLIED', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-yousef/screen-time', role: 'OWNER' });
    const saveButton = await screen.findByRole('button', { name: 'Save' });

    expect(await screen.findByText("This child's device is offline")).toBeInTheDocument();

    await userEvent.click(saveButton);

    // Saving reloads the underlying screen-time/device data (a real refetch,
    // not a no-op), so the page briefly returns to its loading state before
    // settling again -- assert on the final settled state rather than an
    // intermediate render.
    await waitFor(() => {
      expect(screen.getByText('Queued -- pending delivery')).toBeInTheDocument();
      expect(screen.getByText("This child's device is offline")).toBeInTheDocument();
    });
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });
});

describe('ScreenTimePage PCA-SCREEN-BASELINE-1 non-weakenable 60/30 enforcement', () => {
  it('cannot submit a continuous-use limit above 60 minutes through the real Save path', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const limitInput = await screen.findByLabelText('Continuous-use limit (minutes)');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '90');
    await userEvent.click(saveButton);

    expect(
      await screen.findByText(/cannot be set above 60 minutes/i),
    ).toBeInTheDocument();
    // The invalid submission must never be treated as queued/applied.
    expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('cannot submit a break duration below 30 minutes through the real Save path', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const breakInput = await screen.findByLabelText('Break duration (minutes)');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await userEvent.clear(breakInput);
    await userEvent.type(breakInput, '15');
    await userEvent.click(saveButton);

    expect(
      await screen.findByText(/cannot be set below 30 minutes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
    expect(screen.queryByText('Applied on device')).not.toBeInTheDocument();
  });

  it('cannot submit the classic 180/5 weakened combo -- both errors surface and nothing is queued', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const limitInput = await screen.findByLabelText('Continuous-use limit (minutes)');
    const breakInput = screen.getByLabelText('Break duration (minutes)');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '180');
    await userEvent.clear(breakInput);
    await userEvent.type(breakInput, '5');
    await userEvent.click(saveButton);

    expect(await screen.findByText(/cannot be set above 60 minutes/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be set below 30 minutes/i)).toBeInTheDocument();
    expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
  });

  it('still allows a stricter-than-baseline policy (45/30) to save successfully', async () => {
    renderWithProviders(<TestApp />, { route: '/children/child-amir/screen-time', role: 'OWNER' });
    const limitInput = await screen.findByLabelText('Continuous-use limit (minutes)');
    const saveButton = screen.getByRole('button', { name: 'Save' });

    await userEvent.clear(limitInput);
    await userEvent.type(limitInput, '45');
    await userEvent.click(saveButton);

    await waitFor(() => expect(screen.getByText('Queued -- pending delivery')).toBeInTheDocument());
    expect(screen.queryByText(/cannot be set/i)).not.toBeInTheDocument();
  });

  describe('legacy stored policy that predates the baseline', () => {
    const childId = 'child-yousef';
    let originalFixture: ScreenTimeStatus;

    beforeEach(() => {
      originalFixture = DEV_SCREEN_TIME[childId];
      // Simulate a policy authored before PCA-SCREEN-BASELINE-1 existed: a continuous-use limit
      // well above the new ceiling.
      DEV_SCREEN_TIME[childId] = {
        ...originalFixture,
        continuousUseLimitMinutes: 90,
        breakDurationMinutes: 15,
      };
    });

    afterEach(() => {
      DEV_SCREEN_TIME[childId] = originalFixture;
    });

    it('is surfaced with a clear warning on load rather than silently treated as compliant', async () => {
      renderWithProviders(<TestApp />, { route: `/children/${childId}/screen-time`, role: 'OWNER' });
      expect(
        await screen.findByText(/saved screen-time policy predates the mandatory 60\/30 anti-gaming baseline/i),
      ).toBeInTheDocument();
    });

    it('cannot be re-saved unchanged -- the parent must strengthen it first', async () => {
      renderWithProviders(<TestApp />, { route: `/children/${childId}/screen-time`, role: 'OWNER' });
      const saveButton = await screen.findByRole('button', { name: 'Save' });

      await userEvent.click(saveButton);

      expect(await screen.findByText(/cannot be set above 60 minutes/i)).toBeInTheDocument();
      expect(screen.queryByText('Queued -- pending delivery')).not.toBeInTheDocument();
    });
  });
});
