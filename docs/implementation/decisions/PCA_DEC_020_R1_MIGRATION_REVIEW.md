# PCA-DEC-020-R1 — Migration 0044 Review

Status: SOURCE-ONLY REVIEW — NOT EXECUTED

## Classification

- `ADDITIVE_ONLY = YES`: two new InnoDB challenge tables and two defaulted
  epoch-floor columns are introduced; existing columns and rows are not
  rewritten by application code.
- `DESTRUCTIVE_DDL = NO`: no table or column is dropped and no existing
  constraint is weakened.
- `EXISTING_DATA_MUTATED = NO`: existing chain-head rows receive the declared
  metadata default of `1` as part of the schema alteration; no account,
  family, device, role, key, or authority row is created or changed.
- `BACKWARD_COMPATIBLE = PARTIAL`: the new tables are inert to pre-R1 code,
  but the current R1 authority reader expects the epoch-floor columns. The
  migration must therefore precede R1 process startup in an owner-controlled
  environment.

## Objects

`parent_genesis_challenges` binds a verified Parent account and service
account to one proposed family/device/DSK/platform challenge. The request
challenge table binds sensitive HTTP operations to session, device, key,
request digest, and one-time consumption. `family_authority_chain_heads`
stores the minimum trust-set and DSK epochs accepted by the authority reader.

## Rollback preparation

Rollback is a change-management operation, not an application request: take a
disposable-environment schema backup, stop R1 readers, remove only the two new
tables, then reverse the two epoch-column alterations in that environment.
Production rollback remains owner-controlled and requires a fresh backup and
foreign-key/dependency review. No production migration or rollback was run by
this source lane.

## Required validation

Apply 0001 through 0044 only to a disposable MySQL instance, inspect the
resulting `SHOW CREATE TABLE` output, run the migration-upgrade safety suite,
and then run the R1 atomicity, replay, epoch, and HTTP proof tests. A missing
Docker/MySQL instance is recorded as `NOT_EXECUTED`, never as PASS.
