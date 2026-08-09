# 02 — Stakeholders, Personas and Roles

## 1. Family roles

### Family Owner
The adult who creates the PCA family and controls recovery.

Permissions:
- all child devices;
- all policies;
- parent membership;
- recovery keys;
- billing/license settings;
- retention/deletion;
- device removal.

### Parent/Guardian Administrator
May manage child policies and review permitted reports but cannot transfer ownership or replace the family recovery authority unless explicitly delegated.

### Parent/Guardian Viewer
Read-only family status and activity reports. No policy changes.

### Child
Subject of parental-control policies. Has access to transparency, remaining-time, request-more-time and emergency functions. Cannot receive parent-only secret credentials.

### PCA Service Operator
May administer service availability, licenses and software delivery. Must not have technical access to decrypt family monitoring payloads.

### PCA Support Agent
May view account/enrollment metadata that is necessary for support but not family activity content or family private keys.

## 2. Family structure

A family may contain:
- 1 Family Owner;
- 0..N Parent/Guardian Administrators;
- 0..N Parent/Guardian Viewers;
- 1..N children;
- 1..N devices per child subject to subscription.

## 3. Role-assignment rules

- Parent roles require adult authentication in the product flow.
- Role changes are auditable locally to the family.
- Removing the Family Owner requires recovery/ownership-transfer flow.
- Child devices never become administrative authorities.
- Parent-to-parent data synchronization uses family encryption keys, not shared plaintext passwords.

## 4. Trust boundaries

- The parent device is trusted for family-policy administration after strong authentication.
- The child device is trusted to enforce signed family policy but is assumed tamper-attemptable.
- PCA servers are trusted for availability and enrollment routing, not for confidentiality of family activity.
