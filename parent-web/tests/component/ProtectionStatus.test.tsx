// PCA product-completion programme (/security/status): proves
// ProtectionStatus.tsx wires REAL envelopes from
// clients.protectionAlertDelivery into ProtectionAlertPanel -- never the
// hardcoded `alerts={[]} feedState="PENDING_TRUSTED_DECRYPTION"` the page
// used before -- while still preserving the honest pending-decryption
// state whenever the delivery client reports it. Mirrors the pattern
// already established for Audit.test.tsx.
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import ProtectionStatus from '../../src/pages/security/ProtectionStatus';
import { getApiClients } from '../../src/api/client';

describe('ProtectionStatus renders real protection-alert envelopes, and the honest pending-decryption state', () => {
  it('renders a real alert trigger label for each envelope the delivery client reports, not a hardcoded empty panel', async () => {
    const clients = getApiClients();
    const original = clients.protectionAlertDelivery;
    clients.protectionAlertDelivery = {
      async list() {
        return {
          status: 'READY',
          alerts: [{ alertId: 'alert-1', deviceId: 'device-1', trigger: 'PROTECTION_DEGRADED', generatedAtUtc: '2026-01-01T00:00:00.000Z' }],
        };
      },
    };
    try {
      renderWithProviders(<ProtectionStatus />);

      expect(await screen.findByText('Protection degraded')).toBeInTheDocument();
      expect(screen.queryByText('Alerts are waiting for decryption by a trusted parent device.')).not.toBeInTheDocument();
    } finally {
      clients.protectionAlertDelivery = original;
    }
  });

  it('shows the honest pending-decryption message, never a fabricated empty state, when the delivery client reports it is not ready', async () => {
    const clients = getApiClients();
    const original = clients.protectionAlertDelivery;
    clients.protectionAlertDelivery = {
      async list() {
        return { status: 'PENDING_TRUSTED_DECRYPTION' };
      },
    };
    try {
      renderWithProviders(<ProtectionStatus />);

      expect(await screen.findByText('Alerts are waiting for decryption by a trusted parent device.')).toBeInTheDocument();
    } finally {
      clients.protectionAlertDelivery = original;
    }
  });

  it('shows a genuine empty state (not pending) when the family really has zero protection alerts', async () => {
    const clients = getApiClients();
    const original = clients.protectionAlertDelivery;
    clients.protectionAlertDelivery = {
      async list() {
        return { status: 'READY', alerts: [] };
      },
    };
    try {
      renderWithProviders(<ProtectionStatus />);

      expect(await screen.findByText('No security alerts are available.')).toBeInTheDocument();
      expect(screen.queryByText('Alerts are waiting for decryption by a trusted parent device.')).not.toBeInTheDocument();
    } finally {
      clients.protectionAlertDelivery = original;
    }
  });
});
