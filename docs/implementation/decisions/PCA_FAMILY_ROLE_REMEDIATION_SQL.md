# PCA family-role remediation SQL (owner-executed, not run by the coordinator)

This is a bounded, transaction-safe proposal for the two verified accounts
identified by the owner. It is intentionally unusable until secure genesis has
already produced a real `family_id`, family scope, and authority-chain rows.
It never creates a family, family scope, authority anchor, or trust proof.

The email addresses are converted to the same normalized SHA-256 form used by
`parent_accounts.email_hash`; no plaintext email is stored by this SQL.

## Read-only preview

```sql
SELECT
  pa.account_id,
  pa.service_account_id,
  pa.status,
  pa.family_id,
  fs.status AS family_scope_status,
  CASE WHEN ga.family_id IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS genesis_anchor,
  m.role AS current_membership_role,
  m.status AS current_membership_status
FROM parent_accounts pa
LEFT JOIN service_account_family_scopes fs
  ON fs.account_id = pa.service_account_id AND fs.family_id = pa.family_id
LEFT JOIN family_authority_genesis_anchors ga
  ON ga.family_id = pa.family_id
LEFT JOIN family_parent_memberships m
  ON m.account_id = pa.account_id AND m.family_id = pa.family_id
WHERE pa.email_hash IN (
  UNHEX(SHA2(LOWER(TRIM('mosamali2050@gmail.com')), 256)),
  UNHEX(SHA2(LOWER(TRIM('drwishm38@gmail.com')), 256))
);
```

Expected preview precondition: both rows are `VERIFIED`, both have a non-null
`family_id`, the matching scope is `ACTIVE`, and an authority anchor exists.
The current owner evidence does not meet that precondition because both
`family_id` values are NULL.

## Bounded remediation after the precondition passes

Run the following only after a separate owner approval for production data
mutation. The `ROLLBACK` form is the default dry run; replace it with
`COMMIT` only after the before/after results and the exact row count have been
reviewed by the owner.

```sql
START TRANSACTION;

SELECT pa.account_id, pa.service_account_id, pa.family_id, m.role, m.status
FROM parent_accounts pa
LEFT JOIN family_parent_memberships m
  ON m.account_id = pa.account_id AND m.family_id = pa.family_id
WHERE pa.email_hash IN (
  UNHEX(SHA2(LOWER(TRIM('mosamali2050@gmail.com')), 256)),
  UNHEX(SHA2(LOWER(TRIM('drwishm38@gmail.com')), 256))
)
FOR UPDATE;

INSERT INTO family_parent_memberships
  (membership_id, family_id, account_id, service_account_id, role, status, created_at, updated_at)
SELECT UUID(), pa.family_id, pa.account_id, pa.service_account_id,
       'ADMINISTRATOR', 'ACTIVE', CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM parent_accounts pa
JOIN service_account_family_scopes fs
  ON fs.account_id = pa.service_account_id
 AND fs.family_id = pa.family_id
 AND fs.status = 'ACTIVE'
JOIN family_authority_genesis_anchors ga
  ON ga.family_id = pa.family_id
WHERE pa.status = 'VERIFIED'
  AND pa.family_id IS NOT NULL
  AND pa.service_account_id IS NOT NULL
  AND pa.email_hash IN (
    UNHEX(SHA2(LOWER(TRIM('mosamali2050@gmail.com')), 256)),
    UNHEX(SHA2(LOWER(TRIM('drwishm38@gmail.com')), 256))
  )
ON DUPLICATE KEY UPDATE
  service_account_id = COALESCE(VALUES(service_account_id), service_account_id),
  role = 'ADMINISTRATOR',
  status = 'ACTIVE',
  updated_at = VALUES(updated_at);

SELECT ROW_COUNT() AS changed_membership_rows;

SELECT pa.account_id, pa.service_account_id, pa.family_id, m.role, m.status
FROM parent_accounts pa
JOIN family_parent_memberships m
  ON m.account_id = pa.account_id AND m.family_id = pa.family_id
WHERE pa.email_hash IN (
  UNHEX(SHA2(LOWER(TRIM('mosamali2050@gmail.com')), 256)),
  UNHEX(SHA2(LOWER(TRIM('drwishm38@gmail.com')), 256))
);

ROLLBACK;
```

No account is eligible while `family_id` is NULL. Secure genesis or an
owner-approved supported recovery path must establish the family relationship
first; this script must not be changed to fabricate one.
