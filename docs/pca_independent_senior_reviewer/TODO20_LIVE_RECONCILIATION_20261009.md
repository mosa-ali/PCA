# TODO-20 live and local reconciliation receipt

Owner-authorized reconciliation completed 2026-10-08 21:58:59 UTC (2026-10-09 local date). Validated database source: `e4ac7641b1fe536af256956d7d1772e55049135c`, Quality Gates run `37848504607` SUCCESS, all 27 jobs passed. This closes database reconciliation only; it does not authorize deployment or establish owner/device acceptance.

## Local-first evidence

A newly initialized, owned, loopback MySQL 8.4.11 instance reproduced the live 0059 schema with `EXACT_MATCH`. The initial disposable setup used an incorrect default collation and was discarded as acceptance evidence; a separate database was rebuilt using repository-required `utf8mb4_bin`. Its 0059-to-0065 upgrade and replay passed. All 96 runtime table privileges matched the canonical policy, and five forbidden audit/tombstone/journal mutations were denied. Parent/Platform HTTP route audit passed 56/56 with no failures or skips. Both disposable schemas were removed and the owned server stopped.

## Live preflight and execution

Target: `pca-mysql.mysql.database.azure.com/pca_pro`, MySQL `8.4.9-azure`, verified TLS cipher `TLS_AES_256_GCM_SHA384`. Key Vault credentials stayed in process memory. The older enabled administrator-secret version authenticated successfully; neither secret values nor Key Vault state were changed.

Under the repository migration advisory lock, immediate preflight verified all 92 pre-existing table DDL definitions, the exact 57-entry migration journal through 0059, and the exact existing runtime grant matrix with no broad/role grants. Enrollment attempts had zero rows, duplicate token groups, or incompatible result rows. SHA-256 digests over original columns of all affected pre-existing tables were captured immediately before mutation and matched afterward: three Parent accounts, zero authority anchors, zero step-up grants and zero enrollment attempts. No application/reference data was inserted, deleted or rewritten.

The following existing tracked SQL files were executed byte-for-byte, then journaled:

| Migration | SHA-256 |
| --- | --- |
| `0060_family_trust_set_epoch_persistence.sql` | `1d073651ce06e6425d838b5141478ccb74e2aa6ca6d1c0256b77de3e16866627` |
| `0061_parent_password_login_lock.sql` | `a45d9873aabe2712d034ad352d8ca8efedc4c3d0bad0d2715523a10389266f86` |
| `0062_first_device_trust_root_bootstrap.sql` | `397eb77df3ee333aaead6bcbc0e4549883935a5873a0979418e5aa4c8ccb94fc` |
| `0063_first_device_bootstrap_audit_digests.sql` | `9c6f74841cae0310f57301e86caf3fba3c7e3a23f9e27c26684e0b1c7ddbe39b` |
| `0064_enrollment_bootstrap_attempt_resolution.sql` | `78acc9d9b3e977ef68e9bf8eb38e0cc1050bef4572ab9fd7490473b225c4d380` |
| `0065_enrollment_abandoned_attempt_tombstones.sql` | `484909a57cfbd8af249e3ff9a1f09e1e0899f3a303bd36a6e606a809b07a47a0` |

All files reside in `backend/migrations/` and were already published in the validated source. The four exact additional grants are recorded in [the SQL receipt](TODO20_PCA_PRO_RUNTIME_GRANTS_20261009.sql). No existing privilege was revoked or expanded beyond the repository table policy.

## Post-verification and cleanup

Live journal: 63 migrations through 0065. Full live introspection returned `EXACT_MATCH` against the upgraded disposable database: 96 tables, 834 columns, with normalized fingerprint `sha256:2143678ea123e129b1a7eb958a9271651be0834282fcf375fcc10911c4cc6050`. All 96 runtime table grants match the explicit policy; no seed data and zero data loss.

The approved temporary `209.198.151.40` firewall rule was removed after verification. The two original single-IP rules were preserved.

Docker Desktop was restored and the retained `pca_local_owner_uat` database was separately reconciled from 0063 through 0065. Original-column row digests of all 94 pre-existing non-journal tables matched before and after migration and container recreation. Retained schema returned `EXACT_MATCH`; all 96 runtime grants match. Its existing `pca-app_pca_local_mysql` named volume was preserved. Local MySQL now publishes only `127.0.0.1:33061`, the container is healthy, and the existing local backend `/health/db` returns 200.

Local raw introspection, operation reports and route evidence remain ignored under `.agent-local-artifacts/local-uat-mission/`; they contain no saved database credentials. Tracked schema snapshots were not manually edited.

## Remaining mission gates

TODO-12/14/15 authority/device contracts, physical Android/iOS proof, literal owner `LOCALHOST ACCEPTED`, Platform dependency, Azure deployment and production acceptance remain open. Database parity does not close any of them.
