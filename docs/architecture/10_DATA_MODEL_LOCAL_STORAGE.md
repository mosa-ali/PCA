# 10 — Logical Data Model and Local Storage

This is a logical model, not an implementation schema.

## 1. Family configuration entities

### Family
- familyId (opaque)
- createdAt
- defaultLanguage
- defaultRetentionPolicy
- ownerParentDeviceId

### FamilyMember
- memberId
- role: OWNER | ADMIN | VIEWER | CHILD
- displayName
- status

### Device
- deviceId
- memberId
- platform
- platformVersion
- appVersion
- publicKeyId
- enrollmentState
- lastSeenAt
- capabilityProfile

### Policy
- policyId
- childDeviceId
- version
- effectiveFrom
- expiresAt optional
- screenTimePolicy
- contentPolicy
- appPolicy
- locationPolicy
- prayerPolicy
- retentionPolicy

## 2. Activity entities

### UsageSession
- local id
- device id
- app/category token or identifier as platform permits
- startedAt
- endedAt
- duration
- source confidence

### WebVisit
Only for browsing contexts where PCA legitimately obtains the URL.
- local id
- domain
- url optional according to mode
- title optional
- classification
- action allowed/blocked
- timestamps

### ContentBlockEvent
- category
- rule/model version
- reason code
- confidence bucket if AI used
- timestamp
- no prohibited raw media retention by default

### LocationPoint
- timestamp
- latitude/longitude
- accuracy
- source

### BreakSession
- trigger type
- continuous-use duration
- break start/end
- completion reason
- optional counter total

### ProximityEvent
- timestamp
- near/far or approximate distance bucket
- action
- no face image

### PrayerReminderEvent
- prayer key
- scheduledAt
- delivery state

## 3. Security/audit entities

- DeviceKeyMetadata
- PolicyReceipt
- TamperEvent
- ParentActionAudit
- RetentionDeletionReceipt

## 4. Central-service model

Central service has a deliberately separate, minimal model:
- Account/license
- Opaque family id
- Device registration/public keys
- Enrollment invitations
- Push routing metadata
- Revocation status
- Software/rule package metadata
- Short-lived encrypted relay envelopes

No central `web_visits`, `locations`, `usage_sessions`, or readable family-history tables are allowed.
