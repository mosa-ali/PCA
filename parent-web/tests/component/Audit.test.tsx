// PCA product-completion programme, Writer P0-D: proves Audit.tsx renders
// real, human-readable action-type/target-scope labels (not the raw enum
// dump the original implementation used), and shows the honest
// PENDING_TRUSTED_DECRYPTION state -- never a fabricated empty list --
// when the delivery client reports it's not ready yet. Mirrors the pattern
// already established for ProtectionAlertPanel.tsx's own tests.
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../utils/renderWithProviders';
import Audit from '../../src/pages/security/Audit';
import { getApiClients } from '../../src/api/client';

describe('Audit renders real human-readable labels, and the honest pending-decryption state', () => {
  it('renders a human-readable action-type/target-scope/result label for each entry, never the raw enum value', async () => {
    const clients = getApiClients();
    const original = clients.familyAuditDelivery;
    clients.familyAuditDelivery = {
      async list() {
        return {
          status: 'READY',
          entries: [
            {
              eventId: 'event-1',
              actionType: 'ADD_VIEWER',
              actorMemberId: 'member-owner',
              targetScope: 'FAMILY',
              trustSetEpoch: 4,
              policyRevision: 1,
              timestampUtc: '2026-01-01T00:00:00.000Z',
              resultStatus: 'SUCCESS',
              reasonCategory: null,
              correlationId: 'corr-1',
            },
          ],
        };
      },
    };
    try {
      renderWithProviders(<Audit />, { role: 'OWNER' });

      expect(await screen.findByText('Added viewer')).toBeInTheDocument();
      expect(screen.getByText('Family')).toBeInTheDocument();
      expect(screen.getByText('Success')).toBeInTheDocument();
      expect(screen.queryByText('ADD_VIEWER')).not.toBeInTheDocument();
      expect(screen.queryByText('FAMILY')).not.toBeInTheDocument();
    } finally {
      clients.familyAuditDelivery = original;
    }
  });

  it('shows the honest pending-decryption message, never a fabricated empty state, when the crypto gate blocks delivery', async () => {
    const clients = getApiClients();
    const original = clients.familyAuditDelivery;
    clients.familyAuditDelivery = {
      async list() {
        return { status: 'PENDING_TRUSTED_DECRYPTION' };
      },
    };
    try {
      renderWithProviders(<Audit />, { role: 'OWNER' });

      expect(await screen.findByText('Audit entries are waiting for decryption by a trusted parent device.')).toBeInTheDocument();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    } finally {
      clients.familyAuditDelivery = original;
    }
  });

  it('shows a genuine empty state (not pending) when the family really has zero audit events', async () => {
    const clients = getApiClients();
    const original = clients.familyAuditDelivery;
    clients.familyAuditDelivery = {
      async list() {
        return { status: 'READY', entries: [] };
      },
    };
    try {
      renderWithProviders(<Audit />, { role: 'OWNER' });

      expect(await screen.findByText('Nothing here yet')).toBeInTheDocument();
      expect(screen.queryByText('Audit entries are waiting for decryption by a trusted parent device.')).not.toBeInTheDocument();
    } finally {
      clients.familyAuditDelivery = original;
    }
  });
});
