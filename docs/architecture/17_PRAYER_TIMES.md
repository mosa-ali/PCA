# 17 — Prayer-Time Architecture

## 1. Purpose and boundaries

This document designs `PCA-FR-070`–`PCA-FR-074`: local, privacy-preserving daily prayer times and reminders. PCA is not a religious authority. It provides a transparent calculation tool; the Family Owner selects a recognised convention or manually adjusts it, and UI says which configuration produced each time. It does not upload prayer observance, Dhikr text, or reminder interaction to PCA infrastructure.

**PCA-FR-070.** Calculate daily times locally from selected method, location, and timezone, without a PCA server.
**PCA-FR-071.** Display Fajr, Sunrise, Dhuhr, Asr, Maghrib, and Isha.
**PCA-FR-072.** Support calculation-method and Asr-method selection plus per-prayer minute adjustments.
**PCA-FR-073.** Support Arabic/English reminders and optional Adhan only where platform/background rules permit.
**PCA-FR-074.** Continue calculation offline with last-known location/timezone settings.
**PCA-FR-074A.** Surface a stale-location verification notice after material travel rather than silently retaining inaccurate times.

## 2. Calculation contract

The calculation engine accepts: civil date in the location timezone; latitude/longitude and elevation when available; IANA timezone identifier; selected method/profile; Asr shadow factor; high-latitude rule; and signed per-prayer minute offsets. It calculates solar position for the local civil day, then derives:

| Prayer/event | Contract |
|---|---|
| Fajr / Isha | Method-specific depression angle or method-specific fixed interval, never an undocumented global default. |
| Sunrise / Maghrib | Solar-rise/set convention, accounting for configured/evidenced elevation treatment. |
| Dhuhr | Local solar noon plus selected adjustment. |
| Asr | Selected juristic shadow factor (Standard/Shafi'i-Maliki-Hanbali = 1; Hanafi = 2), rendered as a choice rather than inferred from the family. |

Supported profiles must be versioned data, with name, parameters, source/review record, effective version, and deprecation state. Launch candidates include Muslim World League, Egyptian General Authority of Survey, Umm al-Qura, University of Islamic Sciences Karachi, and an explicit custom profile, but no profile is asserted universally correct. **Product default decision:** use a visible owner-selected profile during setup; recommended default is Muslim World League only as a proposed product default, not a theological claim. High-latitude selection offers `angle-based`, `one-seventh`, `middle-of-night`, and `manual`; where calculations are indeterminate, display `needs family choice` rather than inventing a time.

## 3. Offline and travel behaviour

The child and parent each retain encrypted local prayer settings and the current local calculation cache. Daily calculation runs locally at timezone/day boundary and after a material setting change. It requires no PCA server and does not treat a relay timestamp as time authority. Device wall-clock/timezone changes cause recomputation and an audit/tamper-relevant record where relevant; schedule durations use platform timing facilities, while prayer schedule presentation follows the local civil day.

Location source priority: user-selected city/coordinates; currently authorized device location; last known location; none. If a new location/timezone is detected or the cached location is stale after travel, PCA labels the result `location may be outdated` and asks for refresh/selection. It never silently changes a family’s method or manual offsets. When no usable location exists, it preserves the last calculated schedule as clearly stale and offers city selection; it does not claim it is current.

## 4. Reminder delivery and OS limits

| Event | Design | Failure/degradation |
|---|---|---|
| Local reminder | Schedule local notification from the calculated result; configurable per prayer and advance minutes. | Notification denial, battery optimisation, DND, OS scheduling, or reboot may delay/suppress it; show capability state and reschedule where OS permits. |
| Audio/Adhan | Optional on-device approved audio, launched only within platform rules and user sound/DND settings. | Never bypass silent/DND or claim guaranteed background audio. |
| Break/school mode | Prayer reminder can be allowed through PCA’s own non-emergency scheduling policy. | PCA cannot override the OS’s notification/DND choice. Emergency calling remains unaffected. |
| Parent alert | Not used for worship monitoring. | No server-readable prayer-event telemetry. |

Android exact alarms are capability-gated: versions/targets may require special user access and Play policy. iOS local delivery is best effort and requires notification authorization. Therefore a missed reminder is not evidence of non-observance and produces no parent alert.

## 5. Data, privacy, and content governance

Prayer settings, calculation profile/version, location source choice, and optional local reminder configuration are in doc 10’s canonical inventory and follow doc 11 retention. Prayer events and Dhikr-counter taps remain local unless the family explicitly includes their limited record in an encrypted export; counter semantics must not report specific text engagement. No advertising, analytics, email, push payload, crash log, or support bundle may include prayer choices, prayer times, or religious content.

Arabic prayer names and curated content are versioned and reviewed; translators/developers do not improvise religious text. English meaning is labelled as a translation. Parent and child language choices are independent (doc 20).

## 6. Verification

- Golden fixtures cover locations/timezones, DST transitions, negative UTC offsets, high latitude, each profile, Asr method, all manual offsets, and a travel/offline transition.
- Tests compare deterministic results to the documented algorithm/profile inputs, not a claim of universal religious certification.
- Permission/DND/notification-denial/reboot tests show the limitation, never a false delivery confirmation.
- Privacy tests assert no prayer setting, title, counter detail, or calculated time leaves the E2EE/local boundary.

## 7. Official-source handoff for doc 33 (verified 2026-08-10)

| Proposed source ID | Official source | Claim/capability label | Affected requirements |
|---|---|---|---|
| SRC-E-PRAY-001 | [Android: schedule alarms](https://developer.android.com/develop/background-work/services/alarms) | Exact alarms are permission/policy constrained; use only where a user-facing precise alarm needs them. | PCA-FR-072–073 |
| SRC-E-PRAY-002 | [Apple: User Notifications](https://developer.apple.com/documentation/UserNotifications) | iOS supports local notifications; delivery is not guaranteed. | PCA-FR-072–073 |
