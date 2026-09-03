import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { getApiClients } from '../../api/client';

function BellIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      aria-hidden="true"
      focusable="false"
    >
      {/* A bell is symmetric about its vertical axis: nothing to mirror in RTL. */}
      <path d="M6 9.5a6 6 0 0 1 12 0v3.2l1.4 2.6a.6.6 0 0 1-.53.9H5.13a.6.6 0 0 1-.53-.9L6 12.7Z" strokeLinejoin="round" />
      <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Header shortcut to /notifications, with the live unread count.
 *
 * The count is sourced from the real client
 * (`CommercialNotificationClient.unreadCount()`), never derived or guessed.
 *
 * THE HONESTY RULE FOR THIS BADGE: if the call fails -- an untrusted browser
 * endpoint, a backend that is down, any throw at all -- NO badge is rendered.
 * Not a `0`, which would claim "we checked and there is nothing"; not the
 * previous number, which would claim a freshness we do not have. The failure
 * is silent by design: a parent does not need to be told that a decorative
 * count could not be read, and an error banner here would fire on every page
 * of a correctly fail-closed console.
 *
 * The accessible name carries the count, so the badge itself is aria-hidden
 * and is never the only channel for that information.
 */
export function NotificationsBell() {
  const { t } = useTranslation();
  const clients = getApiClients();
  const location = useLocation();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    clients.commercialNotifications
      .unreadCount()
      .then((count) => {
        if (cancelled) return;
        setUnread(Number.isFinite(count) && count >= 0 ? count : null);
      })
      .catch(() => {
        // Fail to "unknown", never to zero -- see this component's own header.
        if (!cancelled) setUnread(null);
      });
    return () => {
      cancelled = true;
    };
    // Re-read as the parent moves around the console (in particular after
    // visiting /notifications and marking things read), so the badge is not a
    // number frozen at first mount.
  }, [clients.commercialNotifications, location.pathname]);

  const showBadge = unread !== null && unread > 0;

  return (
    <Link
      to="/notifications"
      className="header-action"
      aria-label={showBadge ? t('shell.notificationsWithCount', { count: unread }) : t('shell.notifications')}
    >
      <BellIcon />
      {showBadge && (
        <span className="header-badge" aria-hidden="true">
          {unread}
        </span>
      )}
    </Link>
  );
}
