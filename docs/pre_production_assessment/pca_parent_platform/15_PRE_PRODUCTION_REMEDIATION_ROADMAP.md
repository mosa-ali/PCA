# 15 — Pre-Production Remediation Roadmap

Grouped per mission §51. No fixes performed in this mission. Complexity: S/M/L.

## P0 — must fix immediately
*None.* No P0 defects found (no critical security/data-loss/release blocker in either app).

## P1 — must fix before formal pre-production acceptance (parent enrollment journey + repo gate)

| ID | App | Root layer | Issue | Owner | Required fix | Dependency | Validation | Complexity |
|---|---|---|---|---|---|---|---|---|
| PP-F01 | PARENT (+ANDROID) | MULTI_LAYER | Enrollment link base = localhost in the production bundle; Android App-Link host is a placeholder domain | parent-web + Android + deploy | Add production guard + document `VITE_PCA_DEVICE_ENROLLMENT_LINK_BASE_URL`; set it to the parent origin; decide + provision the canonical Android host (DNS + assetlinks) | host decision | Production build contains the real origin; QR/link enrolls on a real device via App Link or the in-app path | M |
| API-F01 + R-PP-05 | BOTH (repo) | MULTI_LAYER | Worktree red (16 backend failures); untracked migrations 0051–0054; lanes mid-flight | coordinator + lanes | Land the in-flight migrations green; commit or park 0051–0054 explicitly; freeze a revision for acceptance | none | Full CI green on a frozen SHA; migrations tracked and environment-applied-state recorded | M |
| PP-F03 | BOTH | PRODUCTION_CONFIGURATION | No digest↔SHA provenance for the live web builds | deployment | Emit/record deploy evidence (digest + source SHA) per app; re-deploy acceptance candidate from the frozen revision | frozen revision (above) | Recorded evidence ties live builds to the assessed SHA | S–M |

## P2 — must fix before production

| ID | App | Root layer | Issue | Owner | Required fix | Dependency | Validation | Complexity |
|---|---|---|---|---|---|---|---|---|
| R-PP-01 | PLATFORM | EXTERNAL/ORG | Production activation + MFA never completed; S7 lockout test pending | owner (runbook ready) | Execute recovery runbook → S4–S7 with evidence | owner availability | Live admin login with TOTP; lockout alert row observed; log scan clean | S (owner-led) |
| R-PP-07 | PARENT | SHARED_CONTRACT | Family provisioning journey for new parents (post-Genesis) unconfirmed/absent in console | owner + product | Confirm intended journey (invitation/platform mediated vs new UI); document it; scope UI if needed | owner decision | A new parent can reach a working family state in production by the documented path | M–L |
| PP-F02 / R-PP-04 | BOTH | PRODUCTION_CONFIGURATION | Per-IP rate limiting ineffective | deployment + backend | Trust the platform front-end chain (or key on its client-IP header); re-run the two-client A/B check | none | Limits engage for a real client; second client unaffected | S |
| R-PP-03 / R-PP-06 | BOTH | API_SOURCE (carried) | API-assessment items that console surfaces depend on (durable device sessions, revocation, audit, policy read-back, post-commit 500) | backend | Execute the API roadmap (its P2 set) | crypto gate exit for F02/F03 | API reports' validations | M (API side) |
| — (product) | PARENT | API_SOURCE | Web Protection authoring remains fail-closed (encrypted storage contract) | product + backend | Approve + implement encrypted rule storage/delivery, or omit the UI deliberately | privacy decision | Feature either works end-to-end or is intentionally hidden | L |

## P3 — hardening / later

| ID | App | Issue | Owner | Complexity |
|---|---|---|---|---|
| PP-F04 | BOTH | HSTS + parent CSP header + drop meta frame-ancestors | deployment/nginx | S |
| PP-F05 | PARENT | Full-suite flake under contention | parent-web tests | S |
| app.pcasafe.com | BOTH | Decide the future-domain plan (docs/public still call it the parent domain; live host is placeholder) | owner + public programme | S |
| Reviewer items F3/F5/F6/F7 (platform lane) | PLATFORM | Behavioural CAS tests; StrictMode guard; activation copy; Genesis page remnant redirect | platform lane | S–M |
