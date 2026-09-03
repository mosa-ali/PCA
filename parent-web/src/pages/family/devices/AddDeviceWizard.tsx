import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getApiClients } from '../../../api/client';
import { useAsync } from '../../../hooks/useAsync';
import { ActionNeededState, AsyncStates, ErrorState } from '../../../components/common/States';
import { PermissionGate } from '../../../rbac/PermissionGate';
import { actionNeededPlanForMessage } from '../../../i18n/errorMessages';
import { formatDateTime, formatNumber } from '../../../i18n/formatters';
import InvitationQrCode from '../InvitationQrCode';
import { CopyableValue, RampPill } from '../DeviceEnrollmentPanel';
import {
  INVITATION_LIFECYCLE,
  copyToClipboard,
  invitationStatusRamp,
  isTerminalInvitationStatus,
  useAndroidAppDownloadUrl,
  useInvitationCreation,
  useInvitations,
} from './enrollmentState';
import type { AgeUxTier, InitialPolicyProfile, RequestedProtectionMode } from '../../../api/deviceEnrollmentClient';
import type { DevicesSectionId } from './DevicesTabs';

/**
 * The guided "Add device" journey: one question per screen, nothing else on
 * the page.
 *
 * WHAT THIS REPLACED: a single form of six stacked `<select>`s -- child
 * profile, age tier (disabled, unexplained), initial policy profile, platform,
 * protection mode -- followed immediately by an Administration-PIN fieldset, a
 * parent-decision request form, two tables and a trailing error paragraph. The
 * PIN now lives only on the Advanced & security section; this file contains
 * exactly one workflow.
 *
 * ANDROID ONLY, PERMANENTLY (for now): the backend refuses `platform=IOS` with
 * `PLATFORM_ENROLLMENT_UNAVAILABLE`, so there is no iOS card, no greyed-out
 * iOS option, and no "coming soon" control a parent could try. A single
 * sentence states that iPhone/iPad are not supported yet.
 */

type StepId = 'child' | 'platform' | 'protection' | 'review' | 'code' | 'app' | 'waiting';

const STEPS: readonly { id: StepId; labelKey: string }[] = [
  { id: 'child', labelKey: 'deviceEnrollment.stepChild' },
  { id: 'platform', labelKey: 'deviceEnrollment.stepPlatform' },
  { id: 'protection', labelKey: 'deviceEnrollment.stepProtection' },
  { id: 'review', labelKey: 'deviceEnrollment.stepReview' },
  { id: 'code', labelKey: 'deviceEnrollment.stepCode' },
  { id: 'app', labelKey: 'deviceEnrollment.stepApp' },
  { id: 'waiting', labelKey: 'deviceEnrollment.stepWaiting' },
];

/** The last step at which nothing has been committed to the server yet. */
const LAST_UNCOMMITTED_STEP = 3; // 'review'

const NEW_CHILD_OPTION = '__new__';

/**
 * A fresh, opaque child-profile identifier.
 *
 * PRODUCT GAP, RAISED NOT PAPERED OVER: there is no backend route that creates
 * or lists a child profile. `childProfileId` is only ever ACCEPTED on
 * invitation creation (validated against `^[A-Za-z0-9_-]{1,128}$`), and a
 * child's display name is family plaintext that only ever reaches a parent
 * through the E2EE path. So the name typed on step 1 is carried in wizard state
 * into this one invitation and is deliberately NOT persisted anywhere -- this
 * file must not invent a persistence mechanism for it.
 *
 * The value is an identifier, not a secret: it authorises nothing on its own.
 */
function newChildProfileId(): string {
  const runtimeCrypto = globalThis.crypto as Crypto | undefined;
  if (runtimeCrypto && typeof runtimeCrypto.randomUUID === 'function') return runtimeCrypto.randomUUID();
  return `child-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M12 3.5 21.5 20H2.5Z" />
      <path d="M12 9.5v4.5M12 17h.01" />
    </svg>
  );
}

function DownloadIcon() {
  // A vertical download arrow. Non-directional: it does NOT mirror in RTL.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      width={18}
      height={18}
    >
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
    </svg>
  );
}

export default function AddDeviceWizard({
  familyId,
  onGoToSection,
}: {
  familyId: string;
  onGoToSection: (section: DevicesSectionId) => void;
}) {
  const { t, i18n } = useTranslation();
  const clients = getApiClients();

  // STEP 0 -- the gate. `getDashboard()` is fail-closed by design in real
  // (non-fixture) mode: it ALWAYS throws EndpointNotTrustedError or
  // CryptoReviewRequiredError. That is the trust gate working, not a failure,
  // and it is not an empty list either. Turning the throw into `children = []`
  // is what produced the "No child profiles available" dead end that stopped a
  // new family enrolling at all.
  const {
    data: dashboard,
    loading: familyLoading,
    error: familyError,
  } = useAsync(() => clients.parentFamilyData.getDashboard(), [familyId]);
  const children = useMemo(() => dashboard?.children ?? [], [dashboard?.children]);

  const [stepIndex, setStepIndex] = useState(0);
  const [childProfileId, setChildProfileId] = useState('');
  const [newChildName, setNewChildName] = useState('');
  const [newChildId, setNewChildId] = useState<string | null>(null);
  const [protectionMode, setProtectionMode] = useState<RequestedProtectionMode>('ANDROID_STANDARD');
  const [initialPolicyProfile, setInitialPolicyProfile] = useState<InitialPolicyProfile>('BALANCED');

  const { invitations, reload: reloadInvitations } = useInvitations(familyId);
  const {
    create,
    creating,
    createError,
    createErrorServerCode,
    justCreated,
    clearJustCreated,
    fallbackCode,
    enrollmentLink,
  } = useInvitationCreation(familyId, reloadInvitations);

  useEffect(() => {
    if (!childProfileId && children[0]) setChildProfileId(children[0].childId);
  }, [childProfileId, children]);

  const selectedChild = children.find((child) => child.childId === childProfileId) ?? null;
  const addingNewChild = childProfileId === NEW_CHILD_OPTION;
  // Derived exactly as before: the tier follows the child's age profile and is
  // never a free choice. A brand-new profile has no age profile yet.
  const ageUxTier: AgeUxTier = selectedChild?.ageProfile === 'TEEN' ? 'TEEN' : 'YOUNG_CHILD';

  const step = STEPS[stepIndex];
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);

  // Keyboard/screen-reader users must land IN the step that just appeared.
  // This is the same guarantee the old consent modal's focus trap gave: the
  // review step is now inline, so focus moves to its heading instead of into a
  // dialog. Skipped on first render so the wizard never steals focus on load.
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    headingRef.current?.focus();
  }, [stepIndex]);

  const createdInvitationId = justCreated?.invitation.invitationId ?? null;
  const liveInvitation =
    (createdInvitationId && invitations?.find((inv) => inv.invitationId === createdInvitationId)) ||
    justCreated?.invitation ||
    null;
  const liveStatus = liveInvitation?.status ?? null;

  // Waiting step: poll the invitation lifecycle until it stops moving. The
  // page updates itself rather than asking a parent to reload.
  const onWaitingStep = step.id === 'waiting';
  useEffect(() => {
    if (!onWaitingStep || !createdInvitationId) return undefined;
    if (liveStatus && isTerminalInvitationStatus(liveStatus)) return undefined;
    const timer = setInterval(() => reloadInvitations(), 6000);
    return () => clearInterval(timer);
  }, [onWaitingStep, createdInvitationId, liveStatus, reloadInvitations]);

  const goBack = useCallback(() => {
    setStepIndex((current) => {
      const next = Math.max(0, current - 1);
      // Stepping back behind the commit point drops the raw token from memory.
      // It is shown once; there is no path that fetches it again.
      if (next <= LAST_UNCOMMITTED_STEP) clearJustCreated();
      return next;
    });
  }, [clearJustCreated]);

  const goNext = useCallback(() => {
    setStepIndex((current) => Math.min(STEPS.length - 1, current + 1));
  }, []);

  const submit = useCallback(async () => {
    const resolvedChildId = addingNewChild ? (newChildId ?? newChildProfileId()) : selectedChild?.childId;
    if (addingNewChild && !newChildId) setNewChildId(resolvedChildId ?? null);
    const created = await create({
      platform: 'ANDROID',
      requestedProtectionMode: protectionMode,
      childProfileId: resolvedChildId,
      ageUxTier,
      initialPolicyProfile,
    });
    if (created) setStepIndex(STEPS.findIndex((s) => s.id === 'code'));
  }, [addingNewChild, newChildId, selectedChild, create, protectionMode, ageUxTier, initialPolicyProfile]);

  /* ---------------------------------------------------------- step 0 gate -- */

  if (familyLoading) return <AsyncStates loading />;

  if (familyError) {
    // BRANCH B -- the fail-closed read. Not an error, not an empty list: the
    // system deliberately declined to hand this browser family data. The
    // honest reason sentence already exists; only the framing was wrong.
    const plan = actionNeededPlanForMessage(familyError, t);
    return (
      <ActionNeededState
        titleKey="deviceEnrollment.familyDataUnavailableTitle"
        body={familyError}
        action={
          plan?.actionLabelKey && plan.actionTo
            ? { labelKey: plan.actionLabelKey, to: plan.actionTo }
            : { labelKey: 'states.browserSetupNeededAction', to: '/security/trusted-browser' }
        }
      />
    );
  }

  if (children.length === 0 && !addingNewChild) {
    // BRANCH C -- the read succeeded and there genuinely is no child yet.
    return (
      <ActionNeededState
        titleKey="deviceEnrollment.noChildYetTitle"
        bodyKey="deviceEnrollment.noChildYetBody"
        showReassurance={false}
      >
        <button
          type="button"
          className="btn btn-primary state-action"
          onClick={() => {
            setChildProfileId(NEW_CHILD_OPTION);
            setNewChildId(newChildProfileId());
          }}
        >
          {t('deviceEnrollment.addNewChild')}
        </button>
      </ActionNeededState>
    );
  }

  /* ------------------------------------------------------------- the steps -- */

  const expiresAt = liveInvitation?.expiresAt ?? null;
  const minutesLeft = expiresAt
    ? Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 60000))
    : null;
  const connected = liveStatus === 'REDEEMED';

  return (
    <PermissionGate action="CREATE_DEVICE_INVITATION" showDisabledFallback>
      <div className="wizard">
        <ol className="wizard-steps">
          {STEPS.map((entry, index) => {
            const classes = ['wizard-step'];
            if (index === stepIndex) classes.push('wizard-step-current');
            else if (index < stepIndex) classes.push('wizard-step-done');
            return (
              <li
                key={entry.id}
                className={classes.join(' ')}
                aria-current={index === stepIndex ? 'step' : undefined}
              >
                {t(entry.labelKey)}
              </li>
            );
          })}
        </ol>

        <div className="wizard-body">
          <h3 ref={headingRef} tabIndex={-1}>
            {t(connected && step.id === 'waiting' ? 'deviceEnrollment.stepConnected' : step.labelKey)}
          </h3>

          {step.id === 'child' && (
            <>
              <fieldset style={{ minInlineSize: 0 }}>
                <legend>{t('deviceEnrollment.childProfile')}</legend>
                {children.map((child) => (
                  <div className="checkbox-row" key={child.childId}>
                    <input
                      type="radio"
                      id={`enrollment-child-${child.childId}`}
                      name="enrollment-child"
                      value={child.childId}
                      checked={childProfileId === child.childId}
                      onChange={() => setChildProfileId(child.childId)}
                    />
                    <label htmlFor={`enrollment-child-${child.childId}`}>{child.displayName}</label>
                  </div>
                ))}
                <div className="checkbox-row">
                  <input
                    type="radio"
                    id="enrollment-child-new"
                    name="enrollment-child"
                    value={NEW_CHILD_OPTION}
                    checked={addingNewChild}
                    onChange={() => {
                      setChildProfileId(NEW_CHILD_OPTION);
                      if (!newChildId) setNewChildId(newChildProfileId());
                    }}
                  />
                  <label htmlFor="enrollment-child-new">{t('deviceEnrollment.addNewChild')}</label>
                </div>
              </fieldset>

              {addingNewChild && (
                <div className="field">
                  <label htmlFor="enrollment-new-child-name">{t('deviceEnrollment.childName')}</label>
                  <input
                    id="enrollment-new-child-name"
                    type="text"
                    value={newChildName}
                    onChange={(e) => setNewChildName(e.target.value)}
                  />
                </div>
              )}

              <div className="field">
                <span>{t('deviceEnrollment.ageUxTier')}</span>
                <p>
                  {t(ageUxTier === 'TEEN' ? 'deviceEnrollment.ageTierTeen' : 'deviceEnrollment.ageTierYoungChild')}
                </p>
                <p className="field-hint">{t('deviceEnrollment.ageTierExplain')}</p>
              </div>
            </>
          )}

          {step.id === 'platform' && (
            <>
              <article className="card">
                <div className="card-header">
                  <h4 className="card-title">{t('deviceEnrollment.platformAndroid')}</h4>
                </div>
                <div className="card-body">
                  <p>{t('deviceEnrollment.androidOnlyNote')}</p>
                </div>
              </article>
              {/*
                No iOS card, and deliberately no disabled iOS control either: a
                greyed-out option still reads as "a thing I could try". The
                `platformIos` / `mode.IOS_STANDARD` copy stays in the locale
                files because existing invitation rows may carry IOS and the
                pending-setup list renders those labels.
              */}
            </>
          )}

          {step.id === 'protection' && (
            <>
              <fieldset style={{ minInlineSize: 0 }}>
                <legend>{t('deviceEnrollment.protectionMode')}</legend>
                {(['ANDROID_STANDARD', 'ANDROID_PROTECTED'] as const).map((mode) => (
                  <div className="checkbox-row" key={mode}>
                    <input
                      type="radio"
                      id={`enrollment-mode-${mode}`}
                      name="enrollment-protection-mode"
                      value={mode}
                      checked={protectionMode === mode}
                      onChange={() => setProtectionMode(mode)}
                    />
                    <label htmlFor={`enrollment-mode-${mode}`}>{t(`deviceEnrollment.mode.${mode}`)}</label>
                  </div>
                ))}
              </fieldset>
              {protectionMode === 'ANDROID_PROTECTED' && (
                // A controlled honesty notice: Protected is a REQUEST at
                // invitation time. Limited-toned and always visible while
                // Protected is selected, not a grey hint below the fold.
                <div className="banner banner-limited">
                  <span className="banner-icon">
                    <WarningIcon />
                  </span>
                  <div className="banner-body">
                    <p className="banner-text">{t('deviceEnrollment.protectedModeNote')}</p>
                  </div>
                </div>
              )}
              <fieldset style={{ minInlineSize: 0 }}>
                <legend>{t('deviceEnrollment.initialPolicyProfile')}</legend>
                {(['BALANCED', 'STRICT'] as const).map((profile) => (
                  <div className="checkbox-row" key={profile}>
                    <input
                      type="radio"
                      id={`enrollment-policy-${profile}`}
                      name="enrollment-policy-profile"
                      value={profile}
                      checked={initialPolicyProfile === profile}
                      onChange={() => setInitialPolicyProfile(profile)}
                    />
                    <label htmlFor={`enrollment-policy-${profile}`}>
                      {t(profile === 'BALANCED' ? 'deviceEnrollment.policyProfileBalanced' : 'deviceEnrollment.policyProfileStrict')}
                    </label>
                  </div>
                ))}
              </fieldset>
            </>
          )}

          {step.id === 'review' && (
            <>
              <ul className="plain-list">
                <li>
                  {t('deviceEnrollment.childProfile')}:{' '}
                  <bdi className="iso">
                    {addingNewChild ? newChildName || t('deviceEnrollment.addNewChild') : selectedChild?.displayName ?? ''}
                  </bdi>
                </li>
                <li>
                  {t('deviceEnrollment.platform')}: {t('deviceEnrollment.platformAndroid')}
                </li>
                <li>
                  {t('deviceEnrollment.protectionMode')}: {t(`deviceEnrollment.mode.${protectionMode}`)}
                </li>
                <li>
                  {t('deviceEnrollment.initialPolicyProfile')}:{' '}
                  {t(initialPolicyProfile === 'BALANCED' ? 'deviceEnrollment.policyProfileBalanced' : 'deviceEnrollment.policyProfileStrict')}
                </li>
              </ul>

              {/* The monitoring-scope disclosure. Wording is pinned by
                  tests/i18n/monitoredFamilyTerminology.test.ts and is rendered
                  verbatim -- it moved out of a modal, it did not change. */}
              <h4>{t('deviceEnrollment.consentTitle')}</h4>
              <p>{t('deviceEnrollment.consentBody')}</p>
              <p>{t('deviceEnrollment.consentMonitored')}</p>
              <p>{t('deviceEnrollment.consentNotMonitored')}</p>

              {createError && (
                <>
                  <ErrorState message={createError} />
                  {createErrorServerCode === 'MANAGED_DEVICE_LIMIT_REACHED' && (
                    <p>
                      <Link to="/subscription/increase-devices">
                        {t('deviceEnrollment.errors.deviceLimitReachedAction')}
                      </Link>
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {step.id === 'code' && justCreated && enrollmentLink && (
            <div className="invite-code-panel">
              <p>{t('deviceEnrollment.tokenRevealBody')}</p>

              {fallbackCode && (
                <>
                  <span className="invite-expiry">{t('deviceEnrollment.fallbackCodeLabel')}</span>
                  <code className="invite-code" data-testid="invitation-fallback-code" dir="ltr">
                    {fallbackCode}
                  </code>
                  <div className="invite-code-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void copyToClipboard(fallbackCode)}
                    >
                      {t('deviceEnrollment.copyFallbackCode')}
                    </button>
                  </div>
                  <p className="field-hint">{t('deviceEnrollment.fallbackCodeBody')}</p>
                </>
              )}

              <InvitationQrCode value={enrollmentLink} />

              <CopyableValue
                value={enrollmentLink}
                copyLabel={t('deviceEnrollment.copyLink')}
                testId="enrollment-link"
              />
              <CopyableValue
                value={justCreated.rawInvitationToken}
                copyLabel={t('deviceEnrollment.copyToken')}
                testId="raw-invitation-token"
              />

              <p className="invite-expiry">
                {t('deviceEnrollment.expiresAt')}:{' '}
                <bdi className="iso">{formatDateTime(liveInvitation?.expiresAt ?? null, i18n.language)}</bdi>
                {minutesLeft !== null && (
                  <> — {t('deviceEnrollment.expiresIn', { minutes: formatNumber(minutesLeft, i18n.language) })}</>
                )}
              </p>
              <p>
                <RampPill
                  ramp={invitationStatusRamp(liveStatus ?? '')}
                  label={t(`deviceEnrollment.invitationStatuses.${liveStatus}`, { defaultValue: liveStatus ?? '' })}
                />
              </p>

              <h4>{t('deviceEnrollment.instructionsTitle')}</h4>
              <ol className="plain-list">
                <li>{t('deviceEnrollment.instruction1')}</li>
                <li>{t('deviceEnrollment.instruction2')}</li>
                <li>{t('deviceEnrollment.instruction3')}</li>
              </ol>

              <div className="banner banner-attention" role="status">
                <span className="banner-icon">
                  <WarningIcon />
                </span>
                <div className="banner-body">
                  <p className="banner-text">{t('deviceEnrollment.tokenNeverAgain')}</p>
                </div>
              </div>
              <p className="field-hint">{t('deviceEnrollment.invitationSecurityNotice')}</p>
            </div>
          )}

          {step.id === 'app' && <GetTheAppStep />}

          {step.id === 'waiting' && (
            <div className="invite-waiting">
              <p>
                <RampPill
                  ramp={invitationStatusRamp(liveStatus ?? '')}
                  label={t(`deviceEnrollment.invitationStatuses.${liveStatus}`, { defaultValue: liveStatus ?? '' })}
                />
              </p>
              {!connected && <p>{t('deviceEnrollment.waitingBody')}</p>}

              {/* The lifecycle a device walks through. Only the stage the
                  server currently reports carries a pill -- the others make no
                  claim, because this page cannot verify them. */}
              <ol className="plain-list">
                {INVITATION_LIFECYCLE.map((stage) => (
                  <li key={stage} aria-current={stage === liveStatus ? 'step' : undefined}>
                    {t(`deviceEnrollment.invitationStatuses.${stage}`, { defaultValue: stage })}
                    {stage === liveStatus && ' ✓'}
                  </li>
                ))}
              </ol>

              {liveStatus === 'AUTHORIZATION_REQUIRED' && (
                <>
                  <p>{t('deviceEnrollment.pairingPlain')}</p>
                  <p className="field-hint">{t('deviceEnrollment.pairingSecurityNotice')}</p>
                  <button type="button" className="btn btn-primary" onClick={() => onGoToSection('pending')}>
                    {t('devicesPage.tabPending')}
                  </button>
                </>
              )}

              {connected && (
                <>
                  <p>{t('deviceEnrollment.pairingPlain')}</p>
                  <button type="button" className="btn btn-primary" onClick={() => onGoToSection('devices')}>
                    {t('devicesPage.tabDevices')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="wizard-actions">
          {stepIndex > 0 && (
            <button type="button" className="btn btn-secondary" onClick={goBack} disabled={creating}>
              {t('common.back')}
            </button>
          )}
          {stepIndex < LAST_UNCOMMITTED_STEP && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={goNext}
              disabled={step.id === 'child' && addingNewChild && newChildName.trim() === ''}
            >
              {t(STEPS[stepIndex + 1].labelKey)}
            </button>
          )}
          {step.id === 'review' && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={creating || !familyId || (!selectedChild && !addingNewChild)}
            >
              {creating ? t('deviceEnrollment.creating') : t('deviceEnrollment.consentContinue')}
            </button>
          )}
          {(step.id === 'code' || step.id === 'app') && (
            <button type="button" className="btn btn-primary" onClick={goNext}>
              {t(STEPS[stepIndex + 1].labelKey)}
            </button>
          )}
        </div>
      </div>
    </PermissionGate>
  );
}

/**
 * Step 6 -- get the app.
 *
 * There is no app-store or APK URL anywhere in this repository. When the
 * install-specific `androidAppDownloadUrl` is unset this renders the honest
 * not-configured treatment. A dead "Download App" button and a fabricated
 * Play Store URL are both forbidden.
 */
function GetTheAppStep() {
  const { t } = useTranslation();
  const downloadUrl = useAndroidAppDownloadUrl();

  if (!downloadUrl) {
    return (
      <ActionNeededState
        titleKey="deviceEnrollment.stepApp"
        bodyKey="deviceEnrollment.downloadUnavailable"
        showReassurance={false}
      />
    );
  }

  return (
    <>
      <a className="btn btn-secondary btn-download-app" href={downloadUrl} rel="noreferrer">
        <DownloadIcon />
        {t('deviceEnrollment.stepApp')}
      </a>
      {/* The same URL as text, for a parent typing it on the child's device. */}
      <CopyableValue value={downloadUrl} copyLabel={t('deviceEnrollment.copyLink')} />
    </>
  );
}
