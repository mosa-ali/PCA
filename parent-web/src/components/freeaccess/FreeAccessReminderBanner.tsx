import { useCallback, useEffect, useState } from 'react';
import { getApiClients } from '../../api/client';
import { useAuth } from '../../state/AuthContext';
import type { FreeAccessStatus } from '../../domain/freeAccess';
import { dismissFreeAccessReminder, isFreeAccessReminderDismissed } from './freeAccessDismissal';
import { FreeAccessReminderBannerView } from './FreeAccessReminderBannerView';

/**
 * FREE_ACCESS_ENFORCEMENT_V1 (Round6, Writer61) -- app-shell-level
 * container: only fetches/renders while a session exists (never before
 * login), fetches once per mount/session change (a "sane daily cadence",
 * per WRITER61_ASSIGNMENT.md -- NOT on every route transition, since this
 * component lives in AppLayout outside the routed <Outlet>, it mounts once
 * per app session, not once per page), and respects the per-day/per-status
 * dismissal recorded in freeAccessDismissal.ts. Renders nothing at all for
 * PERPETUAL, for a session-less visitor, for a still-loading fetch, or if
 * the client honestly reports "no status available" (see
 * RealFreeAccessStatusClient's own doc comment for what null means) --
 * never a placeholder/skeleton implying data that isn't there.
 */
export function FreeAccessReminderBanner() {
  const { session } = useAuth();
  const [status, setStatus] = useState<FreeAccessStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setStatus(null);
      return () => {
        cancelled = true;
      };
    }
    getApiClients()
      .freeAccessStatus.getStatus()
      .then((result) => {
        if (cancelled) return;
        setStatus(result);
        setDismissed(result ? isFreeAccessReminderDismissed(result) : false);
      })
      .catch(() => {
        if (cancelled) return;
        setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const handleDismiss = useCallback(() => {
    if (!status) return;
    dismissFreeAccessReminder(status);
    setDismissed(true);
  }, [status]);

  if (!status || status.status === 'PERPETUAL' || dismissed) return null;

  return <FreeAccessReminderBannerView status={status} onDismiss={handleDismiss} />;
}
