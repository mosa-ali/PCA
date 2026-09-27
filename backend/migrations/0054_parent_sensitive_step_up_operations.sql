-- Extend the existing hashed, account/family/operation-bound one-use MFA
-- grant table to cover sensitive family administration and privacy actions.
-- Grants remain short-lived, single-use and store no raw token or TOTP code.
SET @pca_0054_operation_check_exists = (
  SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE constraint_schema = DATABASE() AND table_name = 'parent_mfa_step_up_grants'
     AND constraint_name = 'parent_mfa_step_up_grants_operation_check'
);
SET @pca_0054_operation_check_has_sensitive = (
  SELECT COUNT(*) FROM information_schema.check_constraints cc
   JOIN information_schema.table_constraints tc
     ON tc.constraint_schema = cc.constraint_schema
    AND tc.constraint_name = cc.constraint_name
   WHERE tc.constraint_schema = DATABASE() AND tc.table_name = 'parent_mfa_step_up_grants'
     AND tc.constraint_name = 'parent_mfa_step_up_grants_operation_check'
     AND cc.check_clause LIKE '%family.security.settings.change%'
);
SET @pca_0054_operation_check_sql = IF(
  @pca_0054_operation_check_exists = 0,
  'ALTER TABLE parent_mfa_step_up_grants ADD CONSTRAINT parent_mfa_step_up_grants_operation_check CHECK (operation IN (''BILLING_CHECKOUT_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_RESUME'', ''family.member.add'', ''family.member.remove'', ''family.member.role_change'', ''family.member.invitation.revoke'', ''family.device.enrollment.revoke'', ''family.retention.update'', ''family.history.export'', ''family.history.delete'', ''family.ownership.transfer'', ''family.recovery.material.reveal'', ''family.security.settings.change''))',
  IF(
    @pca_0054_operation_check_has_sensitive = 0,
    'ALTER TABLE parent_mfa_step_up_grants DROP CHECK parent_mfa_step_up_grants_operation_check, ADD CONSTRAINT parent_mfa_step_up_grants_operation_check CHECK (operation IN (''BILLING_CHECKOUT_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CREATE'', ''FAMILY_COMMERCIAL_REQUEST_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_CANCEL'', ''FAMILY_COMMERCIAL_AUTO_RENEW_RESUME'', ''family.member.add'', ''family.member.remove'', ''family.member.role_change'', ''family.member.invitation.revoke'', ''family.device.enrollment.revoke'', ''family.retention.update'', ''family.history.export'', ''family.history.delete'', ''family.ownership.transfer'', ''family.recovery.material.reveal'', ''family.security.settings.change''))',
    'SELECT 1'
  )
);
PREPARE pca_0054_operation_check_stmt FROM @pca_0054_operation_check_sql;
EXECUTE pca_0054_operation_check_stmt;
DEALLOCATE PREPARE pca_0054_operation_check_stmt;
