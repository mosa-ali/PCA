import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { config } from '../../src/config/env';
import { getApiClients } from '../../src/api/client';
import AddDeviceWizard from '../../src/pages/family/devices/AddDeviceWizard';
import { renderWithProviders } from '../utils/renderWithProviders';

vi.mock('../../src/config/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/config/env')>();
  return {
    ...actual,
    config: {
      ...actual.config,
      demoMode: true,
      production: false,
      childAppDistributionUrl: null,
      childAppEnrollmentReady: false,
      deviceEnrollmentLinkBaseUrl: null,
    },
  };
});

describe('Add Device deployment configuration gate', () => {
  it('does not expose child or invitation creation when the deployment has no configured enrollment link base', async () => {
    const clients = getApiClients();
    const createChildProfile = vi.spyOn(clients.childProfiles, 'createChildProfile');
    const createInvitation = vi.spyOn(clients.deviceEnrollment, 'createInvitation');

    renderWithProviders(
      <AddDeviceWizard familyId="demo-family-1" onGoToSection={vi.fn()} />,
      { role: 'OWNER' },
    );

    expect(await screen.findByRole('heading', { name: 'Android enrollment is not configured' }))
      .toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No child or device invitation was created.');
    expect(screen.queryByLabelText('Child name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'I understand, create invitation' })).not.toBeInTheDocument();
    expect(createChildProfile).not.toHaveBeenCalled();
    expect(createInvitation).not.toHaveBeenCalled();
  });

  it('does not let a production parent create a child or invitation when only the public landing page is configured', async () => {
    const clients = getApiClients();
    const createChildProfile = vi.spyOn(clients.childProfiles, 'createChildProfile');
    const createInvitation = vi.spyOn(clients.deviceEnrollment, 'createInvitation');
    config.production = true;
    config.demoMode = false;
    config.deviceEnrollmentLinkBaseUrl = 'https://www.pcasafe.com/enroll';
    config.childAppDistributionUrl = 'https://www.pcasafe.com/child-app/';
    config.childAppEnrollmentReady = false;
    try {
      renderWithProviders(
        <AddDeviceWizard familyId="demo-family-1" onGoToSection={vi.fn()} />,
        { role: 'OWNER' },
      );

      expect(await screen.findByRole('heading', { name: 'PCA Child is not available for enrollment' }))
        .toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('PCA Child enrollment is not enabled for an approved Android release in this deployment.');
      expect(screen.getByRole('status')).toHaveTextContent('No child or device invitation was created.');
      expect(screen.queryByLabelText('Child name')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
      expect(createChildProfile).not.toHaveBeenCalled();
      expect(createInvitation).not.toHaveBeenCalled();
    } finally {
      config.production = false;
      config.demoMode = true;
      config.deviceEnrollmentLinkBaseUrl = null;
      config.childAppDistributionUrl = null;
      config.childAppEnrollmentReady = false;
    }
  });
});
