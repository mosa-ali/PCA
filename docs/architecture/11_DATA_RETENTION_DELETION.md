# 11 — Data Retention and Deletion

## 1. Parent-selectable policies

Supported activity-retention choices:

- **14 days**
- **1 month**
- **3 months**
- **6 months**
- **9 months**

Architecture default at first enrollment: **1 month**, shown explicitly for parent confirmation.

## 2. Scope

Retention applies to:
- web/PCA browser history;
- content-block history;
- app-usage sessions;
- PCA-controlled YouTube activity;
- screen-time/break sessions;
- proximity/eye-distance events;
- location history;
- non-essential routine device activity.

It does not automatically delete:
- current enrollment identity;
- current device keys;
- current policies/schedules;
- parent roles;
- recovery configuration;
- active license metadata.

## 3. Location special rule

Location history may use a **shorter or equal** retention than the general policy, never longer. The parent may also select “current/last location only” with no historical location trail.

## 4. Deletion algorithm requirement

At least daily, and opportunistically at app start/maintenance windows:

1. compute expiry cut-off using authoritative local calendar/time rules;
2. select records older than retention boundary;
3. delete from active local database;
4. remove associated local cache/index entries;
5. expire queued family replicas that are no longer permitted;
6. compact/securely replace storage where the platform/database permits; do not promise forensic secure erase on flash storage where the OS cannot guarantee it;
7. create a non-sensitive deletion receipt with counts/categories/time.

## 5. “Delete now”

Parent may immediately delete all activity history. Confirmation explains what is deleted and what remains.

## 6. Family removal

A separate “Remove family/device” flow deletes configuration and revokes cryptographic trust after strong parent confirmation.

## 7. Server relay retention

Encrypted undelivered relay envelopes use a short operational TTL, proposed maximum **7 days**, independent of family-history retention. The relay cannot inspect contents.
