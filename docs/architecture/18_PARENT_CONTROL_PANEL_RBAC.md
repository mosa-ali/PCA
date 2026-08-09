# 18 — Parent Control Panel and Family RBAC

## 1. Parent navigation

1. Family Dashboard
2. Child Overview
3. Screen Time
4. App Controls
5. Web Protection
6. YouTube Protection
7. Activity
8. Location
9. Prayer Times
10. Schedules
11. Alerts
12. Child Requests
13. Parent Members
14. Privacy & Data
15. Security & Recovery
16. Subscription/License
17. Settings

## 2. Dashboard cards

Per child:
- protection state;
- online/last seen;
- screen-time summary;
- battery where available;
- location status;
- current break/limit state;
- recent protection alerts.

## 3. Permission matrix

| Action | Owner | Admin | Viewer |
|---|---:|---:|---:|
| View family dashboard | ✓ | ✓ | ✓ |
| Change child rules | ✓ | ✓ | ✗ |
| Approve extra time | ✓ | ✓ | ✗ |
| View permitted activity | ✓ | ✓ | ✓ |
| Change retention | ✓ | ✓ | ✗ |
| Delete activity | ✓ | ✓ | ✗ |
| Add/remove parent | ✓ | configurable | ✗ |
| Transfer ownership | ✓ | ✗ | ✗ |
| Access recovery secret controls | ✓ | ✗ | ✗ |
| Remove child device | ✓ | configurable | ✗ |

## 4. Sensitive actions

Require step-up authentication:
- ownership transfer;
- disable protection;
- remove device;
- export data;
- delete all data;
- reveal/regenerate recovery material;
- add high-privilege parent.

## 5. Child requests

Child may request:
- extra time;
- unblock site/app;
- temporary schedule exception.

Request contains safe metadata and does not email unsafe content previews.
