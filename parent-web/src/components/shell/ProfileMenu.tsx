import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { AuthenticatedSession } from '../../api/interfaces';

/**
 * The header's account control: who is signed in, in what role, and the way
 * to Settings.
 *
 * NO SIGN-OUT CONTROL IS RENDERED. `ServiceAuthClient.signOut()` exists on the
 * API surface (api/interfaces.ts) but has never had a UI affordance, and there
 * is no `shell.signOut` string in either locale. Shipping an English-only
 * button would break the locale contract for an Arabic parent, and inventing
 * the copy is not this writer's call. Raised as a request rather than guessed.
 *
 * A disclosure, not `role="menu"`: the panel's content is a short block of
 * identity text plus one link, which is not a menu of commands, and forcing it
 * into menu semantics would mean either lying about the text rows or dropping
 * them.
 *
 * The panel is only in the DOM while it is open, so its "Settings" link can
 * never collide with the sidebar's Settings link in a name lookup.
 */
interface ProfileMenuProps {
  session: AuthenticatedSession;
}

/** Symmetric about its vertical axis: nothing to mirror under RTL. */
function PersonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 19.25a7 7 0 0 1 14 0" strokeLinecap="round" />
    </svg>
  );
}

export function ProfileMenu({ session }: ProfileMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      // Escape must not strand focus on a panel that just disappeared.
      buttonRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const displayName = session.displayName;

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        ref={buttonRef}
        type="button"
        className="header-profile"
        aria-expanded={open}
        aria-controls="header-profile-panel"
        onClick={() => setOpen((current) => !current)}
        // `.header-profile` sets `min-block-size` but not its inline
        // counterpart, so below 900px -- where this is icon-only -- the button
        // measured 36x44 in a real browser: under the 44px touch target on one
        // axis. The spec calls for a `--touch-target` square. Raised as a
        // request for the rule itself.
        style={{ minInlineSize: 'var(--touch-target)' }}
      >
        <PersonIcon />
        {/*
          The trigger is deliberately labelled "Your account" and NOT with
          session.displayName.

          In real (non-fixture) mode there is no display name to show:
          FAMILY_SERVICE_SESSION_V1 does not carry one, and
          RealServiceAuthClient fills the field with the raw accountId as a
          documented placeholder (`displayName: body.accountId`, with its own
          KNOWN GAP comment). Verified against the live stack -- the value is a
          bare UUID. Putting that in the most prominent slot in the header
          would be dressing a placeholder up as a person's name.

          The identifier is still shown, in the panel below, where an account
          id honestly belongs and where `<bdi class="iso">` can isolate it.
          The visible label here is the first part of the accessible name,
          which is what WCAG 2.5.3 label-in-name requires; below 900px only the
          icon shows and the visually-hidden text carries the whole name.
        */}
        <span className="desktop-only">{t('shell.profile')}</span>
        <span className="visually-hidden">{t('shell.openProfileMenu')}</span>
      </button>
      {open && (
        <div
          id="header-profile-panel"
          className="card"
          style={{
            position: 'absolute',
            insetBlockStart: 'calc(100% + 0.25rem)',
            insetInlineEnd: 0,
            zIndex: 50,
            minInlineSize: '14rem',
          }}
        >
          {/* The account identifier on its own line, isolated. It is NOT
              interpolated into a translated sentence: in Arabic a Latin
              identifier sitting inside RTL prose reorders against the words
              around it, and `<bdi>` can only isolate an element, not a
              substring of a `t()` result. */}
          <p className="text-muted">{t('shell.profile')}</p>
          <p>
            <bdi className="iso">{displayName}</bdi>
          </p>
          <p>{t('shell.role', { role: t(`roles.${session.role.toLowerCase()}`) })}</p>
          <Link to="/settings" onClick={() => setOpen(false)}>
            {t('nav.settings')}
          </Link>
        </div>
      )}
    </div>
  );
}
