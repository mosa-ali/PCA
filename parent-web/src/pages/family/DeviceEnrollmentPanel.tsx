import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AsyncStates } from '../../components/common/States';
import { StatusRampIcon } from '../../components/common/StatusBadge';
import { PermissionGate } from '../../rbac/PermissionGate';
import { copyToClipboard, pairingStatusRamp, usePairing } from './devices/enrollmentState';
import type { RampState } from '../../domain/dashboardStatus';

/**
 * Shared device-enrollment UI pieces for the `/family/devices` sections.
 *
 * This file used to BE the enrollment page: six workflows (create invitation,
 * invitations list, pairing lookup, pairing confirmation, plus the protection
 * PIN and parent-decision panels rendered directly beneath it) stacked in one
 * scroll. It is now the shared-component layer the sectioned page is built
 * from -- `pages/family/devices/AddDeviceWizard.tsx`, `PendingSetupSection.tsx`
 * and `AdvancedSecuritySection.tsx` each render exactly one workflow. The state
 * these components sit on lives in `./devices/enrollmentState.tsx`.
 *
 * SECURITY INVARIANTS PRESERVED ACROSS THE RE-SECTIONING (see
 * api/deviceEnrollmentClient.ts and api/real/realDeviceEnrollmentClient.ts for
 * the server-side contract they mirror). Every one of them survived verbatim:
 *  1. The raw invitation token/link is held only in `useInvitationCreation`'s
 *     local React state (never localStorage/sessionStorage), is shown only
 *     immediately after creation, and nothing anywhere attempts to refetch it
 *     after navigating away or reloading.
 *  2. `confirmPairing` is never invoked automatically; it requires the
 *     explicit button click below.
 *  3. That button is disabled unless BOTH fingerprints are present on a
 *     PAIRING_PENDING request (`canConfirm`).
 *  4. Confirmation results are rendered from the server's own `status` field,
 *     which can only ever be PAIRED (or REVOKED/etc. via other endpoints) --
 *     there is no code path here that renders "ACTIVE".
 *  5. No iOS enrollment path exists, in the UI or in the copy: the backend
 *     refuses `platform=IOS` with `PLATFORM_ENROLLMENT_UNAVAILABLE`
 *     (backend/src/http/routes/invitationRoutes.ts). The `platformIos` /
 *     `mode.IOS_STANDARD` labels stay in the locale files because EXISTING
 *     invitation rows may legitimately carry IOS and the pending-setup list
 *     still renders them.
 */

/**
 * A status pill for a vocabulary `StatusBadge` does not cover (invitation and
 * pairing lifecycles). Same class contract, same glyphs, same weight -- the
 * label is the caller's already-translated text.
 */
export function RampPill({ ramp, label }: { ramp: RampState; label: string }) {
  return (
    <span className={`status-badge status-${ramp}`}>
      <StatusRampIcon ramp={ramp} />
      {label}
    </span>
  );
}

/**
 * A long opaque string (token, link, fingerprint) with a copy button.
 * `.copyable-value` is what keeps a 200-character token from forcing the page
 * to scroll horizontally at 375px.
 */
export function CopyableValue({
  label,
  value,
  copyLabel,
  testId,
  technicalName,
}: {
  label?: string;
  value: string;
  copyLabel?: string;
  testId?: string;
  /** The engineer-facing name, kept as small secondary text for support calls. */
  technicalName?: string;
}) {
  return (
    <div className="copyable-value">
      {label && <span>{label}</span>}
      {/* An opaque Latin identifier must not be reordered by an RTL paragraph. */}
      <code data-testid={testId} dir="ltr">{value}</code>
      {technicalName && <span className="technical-details">{technicalName}</span>}
      {copyLabel && (
        <button type="button" className="btn btn-sm" onClick={() => void copyToClipboard(value)}>
          {copyLabel}
        </button>
      )}
    </div>
  );
}

/**
 * The fingerprint comparison and the confirm button.
 *
 * The two key fingerprints are presented to a parent as "Setup code A" and
 * "Setup code B" -- what they actually do at the kitchen table is read two
 * codes off the child's screen and check they match. The engineer-facing names
 * (DSK / DEK fingerprint) are RETAINED as small secondary text so a support
 * call can still name the exact field.
 *
 * `deviceEnrollment.pairingSecurityNotice` is a controlled honesty notice and
 * is rendered in full, unmodified, right at the point of confirmation: its
 * second and third sentences ("Confirm only after both fingerprints match
 * exactly; do not treat a requested protection mode as proof that managed
 * provisioning succeeded") are the guarantee, not decoration.
 *
 * PRODUCT GAP (raised, not designed around): there is no API that maps an
 * invitation to the device id its pairing request will carry, so even a
 * row-scoped confirmation has to ask for the id the CHILD DEVICE shows on its
 * own setup screen. That is honest -- it is where the number comes from -- but
 * it is not automatic, and it cannot be until such a mapping exists.
 */
export function PairingConfirmation({
  familyId,
  idSuffix,
  describedBy,
}: {
  familyId: string;
  idSuffix: string;
  describedBy?: string;
}) {
  const { t } = useTranslation();
  const [deviceIdDraft, setDeviceIdDraft] = useState('');
  const { pairing, pairingError, pairingLoading, confirming, canConfirm, lookup, confirm } = usePairing(familyId);
  const inputId = `pairing-device-id-${idSuffix}`;

  return (
    <div className="device-section">
      <div className="field">
        <label htmlFor={inputId}>{t('deviceEnrollment.deviceId')}</label>
        {/* An opaque Latin identifier keeps LTR order even inside an RTL page. */}
        <input
          id={inputId}
          type="text"
          dir="ltr"
          aria-describedby={describedBy}
          value={deviceIdDraft}
          onChange={(e) => setDeviceIdDraft(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => void lookup(deviceIdDraft)}
        disabled={pairingLoading || !deviceIdDraft.trim()}
      >
        {t('deviceEnrollment.lookupPairing')}
      </button>

      <AsyncStates loading={pairingLoading} error={pairingError}>
        {pairing && (
          <div className="section-panel">
            <div className="section-panel-head">
              <h4 className="section-panel-title">{t('deviceEnrollment.pairingTitle')}</h4>
              <RampPill
                ramp={pairingStatusRamp(pairing.status)}
                label={t(`deviceEnrollment.pairingStatuses.${pairing.status}`, { defaultValue: pairing.status })}
              />
            </div>
            <div className="fingerprint-grid">
              <CopyableValue
                label={t('deviceEnrollment.setupCodeA')}
                technicalName={t('deviceEnrollment.dskFingerprint')}
                value={pairing.dskFingerprint ?? t('deviceEnrollment.fingerprintPending')}
              />
              <CopyableValue
                label={t('deviceEnrollment.setupCodeB')}
                technicalName={t('deviceEnrollment.dekFingerprint')}
                value={pairing.dekFingerprint ?? t('deviceEnrollment.fingerprintPending')}
              />
            </div>
            <p>{t('deviceEnrollment.fingerprintCompareInstruction')}</p>
            <p className="field-hint">{t('deviceEnrollment.pairingSecurityNotice')}</p>
            <PermissionGate action="CONFIRM_DEVICE_PAIRING" showDisabledFallback>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void confirm()}
                disabled={!canConfirm || confirming}
              >
                {confirming ? t('deviceEnrollment.confirming') : t('deviceEnrollment.confirmPairing')}
              </button>
            </PermissionGate>
            {pairing.status === 'PAIRED' && <p role="status">{t('deviceEnrollment.paired')}</p>}
          </div>
        )}
      </AsyncStates>
    </div>
  );
}
