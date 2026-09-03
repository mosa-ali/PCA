import { useTranslation } from 'react-i18next';
import type { CapabilityState, InstallApprovalCapabilityState, ProtectionDisplayState } from '../../domain/types';
import { rampForStatus, type RampState } from '../../domain/dashboardStatus';

type StatusState = CapabilityState | ProtectionDisplayState | InstallApprovalCapabilityState;

/**
 * ONE ICON PER RAMP STATE. Not decoration.
 *
 * Colour alone may never carry a state (docs/architecture/26, Section 3), and
 * a status ramp with seven members needs more separation than seven hues --
 * a parent with a colour-vision deficiency, or reading a phone in sunlight,
 * gets the same information from the glyph and the label.
 *
 * NONE of these mirrors under `dir="rtl"`:
 *   ok / error / limited  symmetric shapes
 *   attention             symmetric triangle
 *   pending (clock)       clockwise is universal; mirroring it would say time
 *                         runs backwards
 *   offline (cloud+slash) the slash is decorative; one orientation keeps it
 *                         recognisable
 *   unverified (shield)   a shield is a non-directional object
 */
function RampIcon({ ramp }: { ramp: RampState }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: 'false' as const,
  };
  switch (ramp) {
    case 'ok':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m8 12.5 2.5 2.5L16 9.5" />
        </svg>
      );
    case 'limited':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12h8" />
        </svg>
      );
    case 'attention':
      return (
        <svg {...common}>
          <path d="M12 3.5 21.5 20H2.5Z" />
          <path d="M12 9.5v4.5M12 17h.01" />
        </svg>
      );
    case 'pending':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5.5l3.5 2" />
        </svg>
      );
    case 'offline':
      return (
        <svg {...common}>
          <path d="M7 18.5h10a4 4 0 0 0 .5-7.97 6 6 0 0 0-11.2-1.6A3.75 3.75 0 0 0 7 18.5Z" />
          <path d="M4 4l16 16" />
        </svg>
      );
    case 'unverified':
      return (
        <svg {...common}>
          <path d="M12 2.75 4.75 5.5v5.9c0 4.4 3 8.2 7.25 9.85 4.25-1.65 7.25-5.45 7.25-9.85V5.5Z" />
          <path d="M10.25 9.75a1.85 1.85 0 1 1 2.6 1.7c-.55.27-.85.75-.85 1.3v.5M12 16.5h.01" />
        </svg>
      );
    case 'error':
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="m9 9 6 6M15 9l-6 6" />
        </svg>
      );
  }
}

/**
 * The icon for any capability / protection / install-approval state. Exported
 * so the policy-status badge renders the identical glyph for the identical
 * ramp state -- a parent must never learn two different pictures for the same
 * meaning.
 */
export function StatusRampIcon({ ramp }: { ramp: RampState }) {
  // Both class names on purpose: `.status-icon` is the real slot, `.dot` is
  // the alias kept for call sites (billing/RequestStateBadge.tsx) that still
  // render a bare decorative dot. `.dot`'s circle rules are `:empty`-scoped in
  // global.css, so they do not paint behind a real glyph.
  return (
    <span className="status-icon dot" aria-hidden="true">
      <RampIcon ramp={ramp} />
    </span>
  );
}

/**
 * Renders capability state with BOTH an icon AND a text label, so state is
 * never conveyed by colour alone (docs/architecture/26, colour-independent
 * encoding).
 *
 * The class contract is `status-badge status-<ENUM>` verbatim -- component
 * tests assert `status-EPOCH_STALE` and not-`status-ACTIVE` -- and every state
 * gets the same pill height, border width, font size and font weight. The
 * amber/blue/grey/violet states are deliberately NOT lighter, smaller or
 * lower-opacity than the green one: that is what made the honest states read
 * as decorative next to the good one.
 */
export function StatusBadge({ state, size }: { state: StatusState; size?: 'lg' }) {
  const { t } = useTranslation();
  const classes = ['status-badge', `status-${state}`];
  if (size === 'lg') classes.push('status-badge-lg');
  return (
    <span className={classes.join(' ')}>
      <StatusRampIcon ramp={rampForStatus(state)} />
      {t(`state.${state}`)}
    </span>
  );
}
