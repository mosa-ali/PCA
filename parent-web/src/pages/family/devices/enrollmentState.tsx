import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../../api/client';
import { config } from '../../../config/env';
import { useAsync } from '../../../hooks/useAsync';
import { DeviceEnrollmentError } from '../../../api/deviceEnrollmentClient';
import { deriveInvitationFallbackCode } from '../invitationFallbackCode';
import type { RampState } from '../../../domain/dashboardStatus';
import type { CreateInvitationInput, InvitationDto, PairingRequestDto } from '../../../api/deviceEnrollmentClient';

/**
 * Enrollment state and vocabulary shared by the device sections.
 *
 * Split out of `../DeviceEnrollmentPanel.tsx` so that file exports components
 * only (the repo lints `react-refresh/only-export-components` at
 * `--max-warnings=0`). The security invariants documented in that file's header
 * are enforced HERE, in the hooks -- see the notes on each one below.
 */

export function errorMessageKey(err: unknown): string {
  if (err instanceof DeviceEnrollmentError) {
    switch (err.code) {
      case 'UNAUTHORIZED':
        return 'deviceEnrollment.errors.unauthorized';
      case 'FORBIDDEN':
        // MANAGED_DEVICE_LIMIT_REACHED is a real, actionable entitlement
        // state (see backend InvitationService.ts), not a genuine authority
        // rejection -- surface it distinctly so the family is pointed at
        // the increase-devices flow instead of told they lack permission.
        if (err.serverCode === 'MANAGED_DEVICE_LIMIT_REACHED') return 'deviceEnrollment.errors.deviceLimitReached';
        return 'deviceEnrollment.errors.forbidden';
      case 'NOT_FOUND':
        return 'deviceEnrollment.errors.notFound';
      case 'CONFLICT':
        return 'deviceEnrollment.errors.conflict';
      case 'RATE_LIMITED':
        return 'deviceEnrollment.errors.rateLimited';
      case 'NETWORK_ERROR':
        return 'deviceEnrollment.errors.network';
      case 'SERVICE_SESSION_UNAVAILABLE':
        return 'deviceEnrollment.errors.sessionUnavailable';
      case 'INVALID_REQUEST':
        return 'deviceEnrollment.errors.invalidRequest';
      default:
        return 'deviceEnrollment.errors.unknown';
    }
  }
  return 'deviceEnrollment.errors.unknown';
}

/* ------------------------------------------------------------ status ramps --
   Invitation and pairing lifecycles are their own vocabularies, so they are
   mapped onto the SAME seven-state ramp every other status in the console uses
   (domain/dashboardStatus.ts). A parent must not learn a second colour system
   for setup. An unrecognised status is `unverified`, never `ok`: a state this
   build does not know is precisely one it cannot vouch for. */

const INVITATION_STATUS_RAMP: Readonly<Record<string, RampState>> = {
  PENDING: 'pending',
  CREATED: 'pending',
  OPENED: 'pending',
  INSTALL_REQUIRED: 'pending',
  APP_INSTALLED: 'pending',
  AUTHORIZATION_REQUIRED: 'attention',
  REDEEMED: 'ok',
  EXPIRED: 'attention',
  REVOKED: 'error',
};

const PAIRING_STATUS_RAMP: Readonly<Record<string, RampState>> = {
  PAIRING_PENDING: 'pending',
  PAIRED: 'ok',
  REVOKED: 'error',
};

export function invitationStatusRamp(status: string): RampState {
  return INVITATION_STATUS_RAMP[status] ?? 'unverified';
}

export function pairingStatusRamp(status: string): RampState {
  return PAIRING_STATUS_RAMP[status] ?? 'unverified';
}

/** The invitation lifecycle a parent is walked through on the waiting step. */
export const INVITATION_LIFECYCLE: readonly string[] = [
  'CREATED',
  'OPENED',
  'INSTALL_REQUIRED',
  'APP_INSTALLED',
  'AUTHORIZATION_REQUIRED',
  'REDEEMED',
];

/** Statuses that will never change again without the parent doing something. */
export function isTerminalInvitationStatus(status: string): boolean {
  return status === 'REDEEMED' || status === 'REVOKED' || status === 'EXPIRED';
}

export async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard API unavailable in this context -- the value remains
    // visible/selectable in the <code> element as a fallback.
  }
}

/* ---------------------------------------------------------------- hooks --- */

export interface InvitationsState {
  invitations: InvitationDto[] | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useInvitations(familyId: string): InvitationsState {
  const clients = getApiClients();
  const { data, loading, error, reload } = useAsync(
    () => clients.deviceEnrollment.listInvitations(familyId),
    [familyId],
  );
  return { invitations: data, loading, error, reload };
}

export interface InvitationCreationState {
  create: (input: CreateInvitationInput) => Promise<InvitationDto | null>;
  creating: boolean;
  createError: string | null;
  createErrorServerCode: string | null;
  justCreated: { invitation: InvitationDto; rawInvitationToken: string } | null;
  /** Drops the raw token from memory. There is no path that brings it back. */
  clearJustCreated: () => void;
  fallbackCode: string | null;
  enrollmentLink: string | null;
}

/**
 * INVARIANT 1 lives here: `justCreated` (which holds the raw bearer token) is
 * ordinary component state and is never written to Web Storage, never put in
 * the URL, and never refetched -- `listInvitations` cannot return it, by both
 * the client interface's contract and the server's.
 */
export function useInvitationCreation(familyId: string, onCreated?: () => void): InvitationCreationState {
  const { t } = useTranslation();
  const clients = getApiClients();
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createErrorServerCode, setCreateErrorServerCode] = useState<string | null>(null);
  const [justCreated, setJustCreated] = useState<{ invitation: InvitationDto; rawInvitationToken: string } | null>(null);
  const [fallbackCode, setFallbackCode] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFallbackCode(null);
    if (!justCreated?.rawInvitationToken) return () => { cancelled = true; };

    void deriveInvitationFallbackCode(justCreated.rawInvitationToken).then((code) => {
      if (!cancelled) setFallbackCode(code);
    });
    return () => { cancelled = true; };
  }, [justCreated]);

  const create = useCallback(
    async (input: CreateInvitationInput) => {
      setCreateError(null);
      setCreateErrorServerCode(null);
      setCreating(true);
      try {
        const created = await clients.deviceEnrollment.createInvitation(familyId, input);
        const { rawInvitationToken, ...invitation } = created;
        setJustCreated({ invitation, rawInvitationToken });
        onCreated?.();
        return invitation;
      } catch (e) {
        setCreateError(t(errorMessageKey(e)));
        setCreateErrorServerCode(e instanceof DeviceEnrollmentError ? e.serverCode : null);
        return null;
      } finally {
        setCreating(false);
      }
    },
    // `clients` is a stable module-level accessor; `t` changes only on a
    // language switch, which must re-bind so a retried error re-translates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyId, t, onCreated],
  );

  const clearJustCreated = useCallback(() => setJustCreated(null), []);

  const enrollmentLink = justCreated
    ? `${config.deviceEnrollmentLinkBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(justCreated.rawInvitationToken)}`
    : null;

  return {
    create,
    creating,
    createError,
    createErrorServerCode,
    justCreated,
    clearJustCreated,
    fallbackCode,
    enrollmentLink,
  };
}

export interface PairingState {
  pairing: PairingRequestDto | null;
  pairingError: string | null;
  pairingLoading: boolean;
  confirming: boolean;
  /** INVARIANT 3: BOTH fingerprints, on a PAIRING_PENDING request. Nothing else. */
  canConfirm: boolean;
  lookup: (deviceId: string) => Promise<void>;
  confirm: () => Promise<void>;
}

export function usePairing(familyId: string): PairingState {
  const { t } = useTranslation();
  const clients = getApiClients();
  const [pairing, setPairing] = useState<PairingRequestDto | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const lookup = useCallback(
    async (rawDeviceId: string) => {
      const deviceId = rawDeviceId.trim();
      if (!deviceId) return;
      setPairingError(null);
      setPairingLoading(true);
      setPairing(null);
      try {
        setPairing(await clients.deviceEnrollment.getPairingRequest(familyId, deviceId));
      } catch (e) {
        setPairingError(t(errorMessageKey(e)));
      } finally {
        setPairingLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [familyId, t],
  );

  // INVARIANT 2: never automatic. This is only ever reached from an explicit
  // button click in PairingConfirmation.
  const confirm = useCallback(async () => {
    if (!pairing) return;
    setPairingError(null);
    setConfirming(true);
    try {
      // INVARIANT 4: the rendered result is the server's own `status`.
      setPairing(await clients.deviceEnrollment.confirmPairing(familyId, pairing.deviceId));
    } catch (e) {
      setPairingError(t(errorMessageKey(e)));
    } finally {
      setConfirming(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId, pairing, t]);

  const canConfirm =
    !!pairing && pairing.status === 'PAIRING_PENDING' && !!pairing.dskFingerprint && !!pairing.dekFingerprint;

  return { pairing, pairingError, pairingLoading, confirming, canConfirm, lookup, confirm };
}

/**
 * The Android download URL for the wizard's "Get the app" step.
 *
 * `config.androidAppDownloadUrl` is `null` unless a real URL is configured for
 * this deployment -- deliberately, with no default and no fallback. When it is
 * null the step shows the honest not-configured treatment. A dead button and a
 * fabricated Play Store URL are both forbidden; there is no app-store or APK
 * URL anywhere in this repository. Android only: iOS enrollment is refused
 * server-side, so an iOS download would lead a parent to an app that cannot be
 * enrolled.
 */
export function useAndroidAppDownloadUrl(): string | null {
  return useMemo(() => {
    const value = config.androidAppDownloadUrl;
    return typeof value === 'string' && value.trim() !== '' ? value : null;
  }, []);
}
