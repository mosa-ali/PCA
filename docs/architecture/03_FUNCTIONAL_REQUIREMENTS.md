# 03 — Functional Requirements

All requirements are mandatory unless explicitly labeled platform-dependent.

## A. Enrollment and family management

- **PCA-FR-001** Create a family with a Family Owner.
- **PCA-FR-002** Enroll child devices using short-lived QR/invite material.
- **PCA-FR-003** Bind devices using public-key identity, not reusable pairing passwords.
- **PCA-FR-004** Support multiple parent/guardian roles.
- **PCA-FR-005** Allow parent-authorized device removal and secure re-enrollment.
- **PCA-FR-006** Support offline recovery material controlled by the Family Owner.

## B. Screen time and breaks

- **PCA-FR-010** Measure continuous interactive-screen use to the extent supported by the platform.
- **PCA-FR-011** Default continuous-use target: 60 minutes, parent configurable.
- **PCA-FR-012** Default break target: 30 minutes, parent configurable within safe product ranges.
- **PCA-FR-013** Display a child-facing PCA Break experience when enforcement is technically available.
- **PCA-FR-014** Support optional Dhikr/reflection messages and a touch/counter interaction.
- **PCA-FR-015** Emergency access remains available during breaks.
- **PCA-FR-016** Parent may grant temporary extra time.
- **PCA-FR-017** Device restart/time-zone manipulation must not silently reset a running limit.

## C. Eye-distance protection

- **PCA-FR-020** Detect near-face/proximity events where hardware/API supports it.
- **PCA-FR-021** Provide a one-minute eye-rest action when configured conditions are met and platform enforcement permits.
- **PCA-FR-022** Never store face frames or face-recognition templates.
- **PCA-FR-023** Treat exact centimeter estimation as calibrated/approximate unless a reliable depth sensor is available.

## D. Web and content safety

- **PCA-FR-030** Provide local domain/category filtering.
- **PCA-FR-031** Support malware/phishing/scam and adult/explicit-content categories.
- **PCA-FR-032** Provide allowlist/denylist overrides.
- **PCA-FR-033** Provide strict PCA Safe Browser mode for families requiring full URL/title visibility inside PCA-controlled browsing.
- **PCA-FR-034** Do not perform covert TLS interception.
- **PCA-FR-035** Use deterministic rules first and on-device classification only for uncertain content PCA is legitimately processing.
- **PCA-FR-036** Record a reason code when PCA blocks content.

## E. App usage and application control

- **PCA-FR-040** Record application usage duration where platform APIs permit.
- **PCA-FR-041** Support daily/weekly app/category limits where platform APIs permit.
- **PCA-FR-042** Allow parent to block/allow selected apps/categories where supported.
- **PCA-FR-043** Provide a school-mode and bedtime schedule.
- **PCA-FR-044** Clearly label unavailable controls on unsupported platform/device combinations.

## F. YouTube

- **PCA-FR-050** Record YouTube app usage duration where platform usage APIs permit.
- **PCA-FR-051** Do not claim access to official YouTube account watch history through the Data API.
- **PCA-FR-052** Offer optional PCA-controlled YouTube experience if compliant with YouTube API policies, where PCA can record locally the videos started inside that controlled experience.
- **PCA-FR-053** Use available safe-search/restricted-content mechanisms where compliant.

## G. Location and last seen

- **PCA-FR-060** Show latest child-device location when permission, OS state and connectivity allow.
- **PCA-FR-061** Show location timestamp and accuracy class.
- **PCA-FR-062** Show last successful PCA connection (“last seen”).
- **PCA-FR-063** Support optional family geofences subject to platform rules.
- **PCA-FR-064** Never use location for advertising.
- **PCA-FR-065** Support separate shorter retention for location history.

## H. Prayer reminders

- **PCA-FR-070** Calculate daily prayer times locally using selected calculation method, location and time zone.
- **PCA-FR-071** Support Fajr, Sunrise, Dhuhr, Asr, Maghrib and Isha display.
- **PCA-FR-072** Support calculation-method and Asr-method selection and manual minute adjustments.
- **PCA-FR-073** Support Arabic/English reminders and optional Adhan where platform/background rules permit.
- **PCA-FR-074** Continue prayer calculation offline using last known location/time-zone settings.

## I. Anti-tamper and uninstall

- **PCA-FR-080** Detect loss of required permissions/capabilities.
- **PCA-FR-081** Notify parents when protection materially degrades.
- **PCA-FR-082** In Android Protected Mode, use only supported device-policy mechanisms for stronger uninstall/app controls.
- **PCA-FR-083** On iOS child authorization, use Family Controls protections against child deletion when Apple provides them.
- **PCA-FR-084** Authorized parent must always have a supported removal/recovery route.

## J. Parent control panel

- **PCA-FR-090** Provide family dashboard with child status, screen time, battery/last seen where available and alerts.
- **PCA-FR-091** Provide per-child policy pages.
- **PCA-FR-092** Provide activity timeline from locally held/E2EE family data.
- **PCA-FR-093** Provide privacy/data-retention settings.
- **PCA-FR-094** Provide alert and notification preferences including email destination.

## K. Data retention/deletion

- **PCA-FR-100** Supported retention choices: 14 days, 1 month, 3 months, 6 months, 9 months.
- **PCA-FR-101** Default first-enrollment choice presented to parent; architecture baseline default is 1 month unless owner changes this policy before implementation.
- **PCA-FR-102** Allow separate location-history retention no longer than general activity retention.
- **PCA-FR-103** Provide immediate “Delete activity history now”.
- **PCA-FR-104** Deletion must remove expired records from local family stores and queued encrypted replicas.
- **PCA-FR-105** Retention deletion must not remove essential enrollment keys/policies unless the parent selects full device/family removal.

## L. Language and UX

- **PCA-FR-110** Full English LTR.
- **PCA-FR-111** Full Arabic RTL.
- **PCA-FR-112** Parent and child devices may use different languages.
- **PCA-FR-113** All system-generated notices, reports, parental-control explanations and deletion confirmations must be localized.

## M. Privacy and transparency

- **PCA-FR-120** Child device clearly indicates PCA protection is active.
- **PCA-FR-121** Provide “What parents can see” page.
- **PCA-FR-122** PCA central services must not store readable child monitoring history.
- **PCA-FR-123** No behavioral advertising or sale of family monitoring data.
- **PCA-FR-124** Provide local/exportable family audit record for policy changes.
