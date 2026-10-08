-- Exact additive runtime grant statements executed for TODO-20 on 2026-10-08 UTC.
-- Receipt only: the authoritative grant policy remains
-- backend/scripts/db/runtimeGrantPlan.mjs. No credential is included.
-- The 92 existing table grants were verified unchanged; no REVOKE was needed.
GRANT SELECT, INSERT ON `pca_pro`.`enrollment_bootstrap_attempt_tombstones` TO 'pca_runtime_20260918'@'%';
GRANT SELECT, INSERT, UPDATE ON `pca_pro`.`family_epoch_floors` TO 'pca_runtime_20260918'@'%';
GRANT SELECT, INSERT, UPDATE ON `pca_pro`.`family_first_device_bootstrap_ceremonies` TO 'pca_runtime_20260918'@'%';
GRANT SELECT, INSERT ON `pca_pro`.`family_trust_set_epochs` TO 'pca_runtime_20260918'@'%';
