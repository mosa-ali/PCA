// DEVELOPMENT_ONLY fixture implementation of CommercialNotificationClient
// (PCA-MYKIDS-BILL-3). Purely in-memory -- never imported from production
// code paths (see tests/unit/noDevOnlyImportsInProduction.test.ts).
import type { CommercialNotificationClient } from '../interfaces';
import type { CommercialNotification, CommercialNotificationEventType } from '../../domain/billing';

const delay = (ms = 100) => new Promise((r) => setTimeout(r, ms));

let notifications: CommercialNotification[] = [];
let seq = 0;
let nextActionFailure: string | null = null;

/** Test-only: resets fixture state. Not imported by any production file. */
export function __resetDevCommercialNotificationsForTests(): void {
  notifications = [];
  seq = 0;
  nextActionFailure = null;
}

/** Test-only: makes the next markRead/acknowledge call throw, so Notifications.tsx's error-surfacing path is exercisable. */
export function __devFailNextNotificationAction(message: string): void {
  nextActionFailure = message;
}

/** DEV-only: simulates a commercial notification arriving (e.g. after a simulated payment confirmation). Never called from a production code path. */
export function pushDevCommercialNotification(eventType: CommercialNotificationEventType, resourceRef: string | null, messageKey: string): CommercialNotification {
  seq += 1;
  const notification: CommercialNotification = {
    notificationId: `dev-notification-${seq}`,
    eventType,
    resourceRef,
    messageKey,
    params: null,
    createdAtUtc: new Date().toISOString(),
    readAtUtc: null,
    acknowledgedAtUtc: null,
  };
  notifications = [notification, ...notifications];
  return notification;
}

export class DevCommercialNotificationClient implements CommercialNotificationClient {
  async list(limit?: number): Promise<CommercialNotification[]> {
    await delay();
    return limit !== undefined ? notifications.slice(0, limit) : notifications;
  }

  async unreadCount(): Promise<number> {
    await delay();
    return notifications.filter((n) => n.readAtUtc === null).length;
  }

  async markRead(notificationId: string): Promise<void> {
    await delay();
    if (nextActionFailure) {
      const message = nextActionFailure;
      nextActionFailure = null;
      throw new Error(message);
    }
    notifications = notifications.map((n) => (n.notificationId === notificationId ? { ...n, readAtUtc: new Date().toISOString() } : n));
  }

  async acknowledge(notificationId: string): Promise<void> {
    await delay();
    if (nextActionFailure) {
      const message = nextActionFailure;
      nextActionFailure = null;
      throw new Error(message);
    }
    notifications = notifications.map((n) =>
      n.notificationId === notificationId ? { ...n, acknowledgedAtUtc: new Date().toISOString(), readAtUtc: n.readAtUtc ?? new Date().toISOString() } : n,
    );
  }
}
