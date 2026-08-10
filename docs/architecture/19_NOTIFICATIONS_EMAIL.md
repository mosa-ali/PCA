# 19 — Notifications and Email Architecture

## 1. Design rule

Notifications prompt an authorized person to open PCA; they are not an activity-report transport. Lock screens, push providers, mail servers, mailbox previews, notification history, screenshots, and device backups can expose payloads. Therefore push and PCA-originated email contain no child activity plaintext, URLs, location coordinates/labels, app/YouTube detail, policy values, recovery material, keys, or unredacted audit reason.

## 2. Event classes, channels, and consent

| Class | Examples | Default channel | Quiet-hours rule |
|---|---|---|---|
| Security critical | recovery attempt, trust/revocation, protection materially degraded | generic push; generic verified email only if opted in | PCA quiet hours do not suppress; OS settings/DND remain authoritative |
| Important | pending child request, limit/break needs attention, configured safe-zone transition | generic push; optional generic email | parent-configurable quiet hours/digest |
| Informational | local retention cleanup, weekly summary availability, prayer reminder | local notification or in-app inbox | quiet hours apply |

The user selects channel/category and notification permission in context. Android 13+ can deny `POST_NOTIFICATIONS`; iOS requires user authorization. A denied channel creates an in-app capability state and never silently falls back to a more invasive channel. PCA cannot bypass OS DND, lock-screen privacy settings, background delivery restrictions, or notification delays.

## 3. Push contract

Remote push payload is limited to: opaque message ID, recipient opaque device ID/token, event class, generic locale-neutral template ID or minimal generic text, collapse/deduplication ID, TTL, and deep-link route that contains no sensitive identifier. Example: “PCA has an alert that needs your attention. Open the app.” The parent app unlocks, validates the active trust-set epoch, and fetches/decrypts the full E2EE event from its local/relay path. A push is neither delivery proof nor event acknowledgement.

Push-token registration is infrastructure metadata in doc 10: it is retained only while usable, rotated/revoked on account/device removal, never correlated with activity for analytics, and is not included in exports. Notification actions are safe (`Open PCA`, `Review`) and never approve a sensitive action from the lock screen.

## 4. Email contract

PCA service email is limited to account/security/service notices and generic opt-in alerts to verified parent addresses. The service may process address, verification state, template/version, send time, provider delivery outcome, bounce/suppression, locale preference, and message category. It must not receive family activity plaintext. Subject lines and preheaders are generic too: “PCA: action needed,” not “Ahmed left school.”

The optional detailed-email mode is **not a PCA-cloud feature**. If implemented after privacy/security approval, it is generated locally on the parent device using the parent’s own configured provider and explicit per-send/ongoing consent. It warns that the provider and recipient mailbox are outside PCA E2EE/deletion control. This option is disabled by default and must not leak data through provider OAuth scopes, subject/preheader, attachments, logs, or retry queues.

Address changes, verification, consent changes, unsubscribe/suppression, and security-email sends create minimised audit events. Data subject deletion follows doc 11; legal operational mail metadata is retained only for documented service/security need, never repurposed as family behaviour data.

## 5. Local notifications and accessibility

Prayer and other device-local reminders are scheduled locally where possible. Alert title/body are rendered after the device’s current language preference; parent and child language can differ. Accessibility labels state action and urgency without exposing protected detail. Arabic/English and RTL presentation follows doc 20. A child-facing notification uses transparent, age-appropriate wording and never discloses parent-only reports.

## 6. Failure and verification

`PENDING`, `DELIVERED_BY_PROVIDER`, `OPENED`, and `ACKNOWLEDGED` are distinct. Provider acceptance does not prove device display; opening does not prove reading; no click/open telemetry is used for activity profiling. Repeated failures yield an in-app status only, with rate limits and deduplication to avoid harassment or alert storms.

- Inspect captured APNs/FCM payloads, mail MIME, provider logs, deep links, analytics, and crash reports for prohibited plaintext.
- Test lock-screen redaction, denied permission, DND, token rotation, locale change, offline delivery, duplicate/reordered push, and a revoked device.
- Verify a push does not make an offline/stale device appear current and no action changes policy without the doc 18 signed/step-up flow.

## 7. Official-source handoff for doc 33 (verified 2026-08-10)

| Proposed source ID | Official source | Claim/capability label | Affected requirements |
|---|---|---|---|
| SRC-E-NOTIF-001 | [Android: notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission) | Android 13+ notification delivery is user-permission controlled. | PCA-FR-094, privacy requirements |
| SRC-E-NOTIF-002 | [Apple: asking notification permission](https://developer.apple.com/documentation/UserNotifications/asking-permission-to-use-notifications) | iOS requires authorization for alerts/sounds/badges. | PCA-FR-094 |
| SRC-E-NOTIF-003 | [Apple: User Notifications](https://developer.apple.com/documentation/UserNotifications) | Local and remote notifications exist; delivery is not guaranteed. | PCA-FR-094 |
