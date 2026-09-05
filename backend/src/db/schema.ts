// PCA canonical central database schema -- CANONICAL_EXPECTED_STATE.
//
// This file is the single declarative source of truth for the complete PCA
// central MySQL schema (all 75 tables), derived once by applying every
// accepted migration (backend/migrations/0001 through 0036) from an empty
// database and introspecting the result via
// backend/scripts/introspect-schema.mjs. It is NOT an ORM and does not
// introduce a runtime schema-framework dependency -- it is a strongly typed
// manifest that backend/scripts/generate-bootstrap-sql.mjs reads to
// deterministically emit the one-time live-bootstrap SQL in
// database/live-bootstrap/.
//
// AUTHORITY MODEL (see docs/database/PCA_CANONICAL_SCHEMA_REPORT.md §Authority):
//   CANONICAL_EXPECTED_STATE = this file
//   HISTORICAL_CHANGE_LOG    = backend/migrations/*.sql (never edited retroactively)
//   FIRST_LIVE_CREATION      = database/live-bootstrap/ (generated FROM this file)
//   FUTURE_CHANGES           = new backend/migrations/NNNN_*.sql files (this file
//                              should then be regenerated/diffed for drift, not
//                              hand-edited ahead of the migration)
//   RUNTIME_CONTRACT         = backend/src/**/*.ts repositories/services
//
// Do not hand-edit column-level facts (type/nullable/default/keys/indexes/FKs)
// without also adding the corresponding migration -- this file must always be
// re-derivable from backend/migrations/*.sql. Table order is alphabetical and
// deterministic.

export type PrivacyClass =
  | 'OPAQUE_IDENTIFIER'
  | 'ACCOUNT_AUTH'
  | 'OPERATIONAL_METADATA'
  | 'SECURITY_METADATA'
  | 'ENCRYPTED_PAYLOAD'
  | 'READABLE_PARENT_DATA'
  | 'READABLE_CHILD_DATA'
  | 'OTHER';

export type RelationshipStatus = 'APPLICATION_ENFORCED_INTENTIONAL' | 'OWNER_DECISION_REQUIRED';

export interface ColumnDefinition {
  readonly name: string;
  readonly columnType: string;
  readonly dataType: string;
  readonly charset: string | null;
  readonly collation: string | null;
  readonly nullable: boolean;
  readonly default: string | null;
  readonly autoIncrement: boolean;
  readonly unsigned: boolean;
  readonly onUpdateCurrentTimestamp: boolean;
  /** Present only for a STORED/VIRTUAL GENERATED ALWAYS AS column; the exact expression text from SHOW CREATE TABLE. */
  readonly generatedExpression: string | null;
  readonly generatedStorage: 'STORED' | 'VIRTUAL' | null;
  readonly privacy: PrivacyClass;
  readonly privacyNote: string;
}

export interface IndexDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly unique: boolean;
}

export interface ForeignKeyDefinition {
  readonly name: string;
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  readonly onDelete: string;
  readonly onUpdate: string;
}

export interface CheckConstraintDefinition {
  readonly name: string;
  readonly clause: string;
}

/**
 * A column shaped like a reference to another table's identity, deliberately
 * NOT backed by a real foreign key. See
 * docs/database/PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for the full analysis.
 * 'OWNER_DECISION_REQUIRED' means no rationale was found in the repository --
 * flagged for the owner to decide, never silently resolved by this schema.
 */
export interface ApplicationEnforcedRelation {
  readonly column: string;
  readonly impliedReferencedTable: string;
  readonly impliedReferencedColumn: string;
  readonly status: RelationshipStatus;
  readonly rationale: string;
  readonly source: string | null;
}

export interface TableDefinition {
  readonly name: string;
  readonly engine: 'InnoDB';
  readonly charset: string;
  readonly collation: string;
  readonly createdByMigration: string;
  readonly alteredByMigrations: readonly string[];
  readonly ownerModule: string;
  readonly columns: readonly ColumnDefinition[];
  readonly primaryKey: readonly string[];
  readonly uniqueIndexes: readonly IndexDefinition[];
  readonly indexes: readonly IndexDefinition[];
  readonly foreignKeys: readonly ForeignKeyDefinition[];
  readonly checkConstraints: readonly CheckConstraintDefinition[];
  readonly applicationEnforcedRelations: readonly ApplicationEnforcedRelation[];
}

export const PCA_CANONICAL_SCHEMA: readonly TableDefinition[] = [
  {
    name: "account_entitlements",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/entitlements",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "plan_ref", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "FREE_STARTER", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "parent_member_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "managed_device_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "parent_member_used_count", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "managed_device_active_count", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "managed_device_reserved_count", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "over_limit_parent_member", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "over_limit_managed_device", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "revision", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "account_entitlements_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "account_entitlements_managed_device_active_count_check", clause: "(`managed_device_active_count` >= 0)" },
      { name: "account_entitlements_managed_device_limit_check", clause: "(`managed_device_limit` >= 0)" },
      { name: "account_entitlements_managed_device_reserved_count_check", clause: "(`managed_device_reserved_count` >= 0)" },
      { name: "account_entitlements_parent_member_limit_check", clause: "(`parent_member_limit` >= 0)" },
      { name: "account_entitlements_parent_member_used_count_check", clause: "(`parent_member_used_count` >= 0)" },
      { name: "account_entitlements_plan_ref_check", clause: "(char_length(`plan_ref`) between 1 and 32)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "plan_ref", impliedReferencedTable: "billing_plans", impliedReferencedColumn: "plan_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Bounded enum-like plan code (e.g. FREE_STARTER), not billing_plans' opaque row id -- type-incompatible by design, same plane-isolation convention.", source: "backend/migrations/0006_platform_entitlements_enrollment_limits.sql" },
    ],
  },
  {
    name: "billing_commercial_markets",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "commercial_market", columnType: "varchar(16)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "default_currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
    ],
    primaryKey: ["commercial_market"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_commercial_markets_currency_fk", columns: ["default_currency_code"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_commercial_markets_currency_fk", columns: ["default_currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_commercial_markets_market_check", clause: "(`commercial_market` in (_utf8mb4'YEMEN',_utf8mb4'GULF',_utf8mb4'GLOBAL_OTHER'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_country_market_rules",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "country_code", columnType: "char(2)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "commercial_market", columnType: "varchar(16)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["country_code"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_country_market_rules_market_fk", columns: ["commercial_market"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_country_market_rules_market_fk", columns: ["commercial_market"], referencedTable: "billing_commercial_markets", referencedColumns: ["commercial_market"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_country_market_rules_country_check", clause: "regexp_like(`country_code`,_utf8mb4'^[A-Z]{2}$')" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_currencies",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "minor_unit_exponent", columnType: "tinyint unsigned", dataType: "tinyint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "enabled", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
    ],
    primaryKey: ["currency_code"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "billing_currencies_code_check", clause: "regexp_like(`currency_code`,_utf8mb4'^[A-Z]{3}$')" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_disputes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "dispute_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_transaction_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "evidence_submitted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "evidence_due_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["dispute_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_disputes_transaction_idx", columns: ["payment_transaction_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_disputes_transaction_fk", columns: ["payment_transaction_id"], referencedTable: "billing_payment_transactions", referencedColumns: ["payment_transaction_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_disputes_status_check", clause: "(`status` in (_utf8mb4'OPEN',_utf8mb4'UNDER_REVIEW',_utf8mb4'WON',_utf8mb4'LOST'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_invoice_lines",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "invoice_line_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invoice_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "description", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent-visible billing/display label (e.g. invoice line description, masked card label) — not child/family activity content." },
      { name: "line_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "quantity", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "plan_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "price_book_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["invoice_line_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_invoice_lines_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_invoice_lines_invoice_id_idx", columns: ["invoice_id"], unique: false },
      { name: "billing_invoice_lines_plan_fk", columns: ["plan_id"], unique: false },
      { name: "billing_invoice_lines_price_book_fk", columns: ["price_book_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_invoice_lines_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_invoice_lines_invoice_fk", columns: ["invoice_id"], referencedTable: "billing_invoices", referencedColumns: ["invoice_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_invoice_lines_plan_fk", columns: ["plan_id"], referencedTable: "billing_plans", referencedColumns: ["plan_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_invoice_lines_price_book_fk", columns: ["price_book_id"], referencedTable: "billing_price_books", referencedColumns: ["price_book_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_invoice_lines_description_check", clause: "(char_length(`description`) between 1 and 255)" },
      { name: "billing_invoice_lines_line_type_check", clause: "(`line_type` in (_utf8mb4'PLAN_CHARGE',_utf8mb4'PRORATION',_utf8mb4'DEVICE_LIMIT_INCREASE',_utf8mb4'CREDIT',_utf8mb4'OTHER'))" },
      { name: "billing_invoice_lines_quantity_check", clause: "(`quantity` >= 1)" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_invoices",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "invoice_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "subscription_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "total_amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "due_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "period_start", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "period_end", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["invoice_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_invoices_account_ref_idx", columns: ["account_ref"], unique: false },
      { name: "billing_invoices_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_invoices_subscription_fk", columns: ["subscription_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_invoices_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_invoices_subscription_fk", columns: ["subscription_id"], referencedTable: "billing_subscriptions", referencedColumns: ["subscription_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_invoices_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 64)" },
      { name: "billing_invoices_status_check", clause: "(`status` in (_utf8mb4'DRAFT',_utf8mb4'OPEN',_utf8mb4'PAID',_utf8mb4'VOID',_utf8mb4'UNCOLLECTIBLE'))" },
      { name: "billing_invoices_total_check", clause: "(`total_amount_minor` >= 0)" },
    ],
    applicationEnforcedRelations: [
      { column: "account_ref", impliedReferencedTable: "parent_accounts", impliedReferencedColumn: "account_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Billing/commercial plane isolation from the family plane.", source: "backend/test/billing/schemaPrivacy.test.mjs; backend/test/db/billingCoreSchemaPrivacy.mysql.test.mjs" },
    ],
  },
  {
    name: "billing_payment_attempts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "payment_attempt_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invoice_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "increase_request_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_method_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "quote_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "price_book_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "price_book_version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "target_device_limit", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider_reference", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "External payment provider's own correlation string, not a PCA table reference." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["payment_attempt_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_payment_attempts_account_ref_idx", columns: ["account_ref"], unique: false },
      { name: "billing_payment_attempts_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_payment_attempts_increase_request_ref_idx", columns: ["increase_request_ref"], unique: false },
      { name: "billing_payment_attempts_invoice_id_idx", columns: ["invoice_id"], unique: false },
      { name: "billing_payment_attempts_payment_method_fk", columns: ["payment_method_id"], unique: false },
      { name: "billing_payment_attempts_price_book_fk", columns: ["price_book_id"], unique: false },
      { name: "billing_payment_attempts_quote_fk", columns: ["quote_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_payment_attempts_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_attempts_invoice_fk", columns: ["invoice_id"], referencedTable: "billing_invoices", referencedColumns: ["invoice_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_attempts_payment_method_fk", columns: ["payment_method_id"], referencedTable: "billing_payment_methods", referencedColumns: ["payment_method_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_attempts_price_book_fk", columns: ["price_book_id"], referencedTable: "billing_price_books", referencedColumns: ["price_book_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_attempts_quote_fk", columns: ["quote_id"], referencedTable: "billing_quotes", referencedColumns: ["quote_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_payment_attempts_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 64)" },
      { name: "billing_payment_attempts_amount_check", clause: "(`amount_minor` >= 0)" },
      { name: "billing_payment_attempts_increase_request_ref_check", clause: "((`increase_request_ref` is null) or (char_length(`increase_request_ref`) between 1 and 64))" },
      { name: "billing_payment_attempts_status_check", clause: "(`status` in (_utf8mb4'CREATED',_utf8mb4'PENDING',_utf8mb4'CONFIRMED',_utf8mb4'FAILED',_utf8mb4'CANCELLED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "account_ref", impliedReferencedTable: "parent_accounts", impliedReferencedColumn: "account_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Billing/commercial plane isolation from the family plane.", source: "backend/test/billing/schemaPrivacy.test.mjs" },
      { column: "increase_request_ref", impliedReferencedTable: "entitlement_change_requests", impliedReferencedColumn: "request_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque identifier of the entitlement increase-request this payment corresponds to; no FK.", source: "backend/src/billing/entitlementContract.ts:21" },
    ],
  },
  {
    name: "billing_payment_methods",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "payment_method_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "provider", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider_payment_method_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "brand", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "display_label", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent-visible billing/display label (e.g. invoice line description, masked card label) — not child/family activity content." },
      { name: "last4", columnType: "char(4)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Last 4 digits of a payment card, standard minimal display data." },
      { name: "expiry_month", columnType: "tinyint unsigned", dataType: "tinyint", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "expiry_year", columnType: "smallint unsigned", dataType: "smallint", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["payment_method_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_payment_methods_account_ref_idx", columns: ["account_ref"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "billing_payment_methods_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 64)" },
      { name: "billing_payment_methods_expiry_month_check", clause: "((`expiry_month` is null) or (`expiry_month` between 1 and 12))" },
      { name: "billing_payment_methods_last4_check", clause: "((`last4` is null) or regexp_like(`last4`,_utf8mb4'^[0-9]{4}$'))" },
      { name: "billing_payment_methods_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'REMOVED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "account_ref", impliedReferencedTable: "parent_accounts", impliedReferencedColumn: "account_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Billing/commercial plane isolation from the family plane.", source: "backend/test/billing/schemaPrivacy.test.mjs" },
    ],
  },
  {
    name: "billing_payment_transactions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "payment_transaction_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_attempt_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invoice_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider_transaction_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "quote_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "price_book_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "price_book_version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "confirmed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["payment_transaction_id"],
    uniqueIndexes: [
      { name: "billing_payment_transactions_attempt_key", columns: ["payment_attempt_id"], unique: true },
    ],
    indexes: [
      { name: "billing_payment_transactions_account_ref_idx", columns: ["account_ref"], unique: false },
      { name: "billing_payment_transactions_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_payment_transactions_invoice_fk", columns: ["invoice_id"], unique: false },
      { name: "billing_payment_transactions_price_book_fk", columns: ["price_book_id"], unique: false },
      { name: "billing_payment_transactions_quote_fk", columns: ["quote_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_payment_transactions_attempt_fk", columns: ["payment_attempt_id"], referencedTable: "billing_payment_attempts", referencedColumns: ["payment_attempt_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_transactions_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_transactions_invoice_fk", columns: ["invoice_id"], referencedTable: "billing_invoices", referencedColumns: ["invoice_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_transactions_price_book_fk", columns: ["price_book_id"], referencedTable: "billing_price_books", referencedColumns: ["price_book_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_payment_transactions_quote_fk", columns: ["quote_id"], referencedTable: "billing_quotes", referencedColumns: ["quote_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_payment_transactions_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 64)" },
      { name: "billing_payment_transactions_amount_check", clause: "(`amount_minor` >= 0)" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_plans",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "plan_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "plan_code", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "plan_version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "billing_cadence", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "default_parent_member_limit", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "default_managed_device_limit", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "price_book_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["plan_id"],
    uniqueIndexes: [
      { name: "billing_plans_code_version", columns: ["plan_code", "plan_version"], unique: true },
    ],
    indexes: [
      { name: "billing_plans_price_book_fk", columns: ["price_book_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_plans_price_book_fk", columns: ["price_book_id"], referencedTable: "billing_price_books", referencedColumns: ["price_book_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_plans_cadence_check", clause: "(`billing_cadence` in (_utf8mb4'MONTHLY',_utf8mb4'ANNUAL',_utf8mb4'ONE_TIME',_utf8mb4'FREE'))" },
      { name: "billing_plans_plan_code_check", clause: "(char_length(`plan_code`) between 1 and 64)" },
      { name: "billing_plans_status_check", clause: "(`status` in (_utf8mb4'DRAFT',_utf8mb4'ACTIVE',_utf8mb4'RETIRED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_price_books",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/entitlements",
    columns: [
      { name: "price_book_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "commercial_market", columnType: "varchar(16)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "target_device_limit", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "price_book_version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "effective_from", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "effective_to", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "created_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "open_active_key", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: "(case when ((`status` = _utf8mb4'ACTIVE') and (`effective_to` is null)) then concat(`commercial_market`,_ascii'|',`currency_code`,_ascii'|',`target_device_limit`) else NULL end)", generatedStorage: "STORED", privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
    ],
    primaryKey: ["price_book_id"],
    uniqueIndexes: [
      { name: "billing_price_books_key_version", columns: ["commercial_market", "currency_code", "target_device_limit", "price_book_version"], unique: true },
      { name: "billing_price_books_open_active_key", columns: ["open_active_key"], unique: true },
    ],
    indexes: [
      { name: "billing_price_books_admin_fk", columns: ["created_by_admin_id"], unique: false },
      { name: "billing_price_books_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_price_books_lookup_idx", columns: ["commercial_market", "currency_code", "target_device_limit", "effective_from"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_price_books_admin_fk", columns: ["created_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_price_books_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_price_books_market_fk", columns: ["commercial_market"], referencedTable: "billing_commercial_markets", referencedColumns: ["commercial_market"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_price_books_amount_check", clause: "(`amount_minor` >= 0)" },
      { name: "billing_price_books_period_check", clause: "((`effective_to` is null) or (`effective_to` >= `effective_from`))" },
      { name: "billing_price_books_status_check", clause: "(`status` in (_utf8mb4'DRAFT',_utf8mb4'ACTIVE',_utf8mb4'RETIRED'))" },
      { name: "billing_price_books_target_check", clause: "(`target_device_limit` >= 1)" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_provider_events",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "provider_event_row_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "provider", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider_event_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "received_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "processing_status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "correlation_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["provider_event_row_id"],
    uniqueIndexes: [
      { name: "billing_provider_events_provider_event_key", columns: ["provider", "provider_event_id"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "billing_provider_events_status_check", clause: "(`processing_status` in (_utf8mb4'RECEIVED',_utf8mb4'PROCESSED',_utf8mb4'IGNORED',_utf8mb4'FAILED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_quotes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "quote_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "increase_request_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "commercial_market", columnType: "varchar(16)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "target_device_limit", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "issued_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "issued_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
    ],
    primaryKey: ["quote_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_quotes_admin_fk", columns: ["issued_by_admin_id"], unique: false },
      { name: "billing_quotes_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_quotes_increase_request_ref_idx", columns: ["increase_request_ref"], unique: false },
      { name: "billing_quotes_market_fk", columns: ["commercial_market"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_quotes_admin_fk", columns: ["issued_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_quotes_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_quotes_market_fk", columns: ["commercial_market"], referencedTable: "billing_commercial_markets", referencedColumns: ["commercial_market"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_quotes_amount_check", clause: "(`amount_minor` >= 0)" },
      { name: "billing_quotes_expiry_check", clause: "(`expires_at` > `issued_at`)" },
      { name: "billing_quotes_increase_request_ref_check", clause: "((`increase_request_ref` is null) or (char_length(`increase_request_ref`) between 1 and 64))" },
      { name: "billing_quotes_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'CONSUMED',_utf8mb4'EXPIRED',_utf8mb4'SUPERSEDED'))" },
      { name: "billing_quotes_target_check", clause: "(`target_device_limit` >= 1)" },
    ],
    applicationEnforcedRelations: [
      { column: "increase_request_ref", impliedReferencedTable: "entitlement_change_requests", impliedReferencedColumn: "request_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque identifier of the entitlement increase-request; no FK.", source: "backend/src/billing/entitlementContract.ts:21" },
    ],
  },
  {
    name: "billing_refund_operations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0008_payment_orchestration.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "refund_operation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_transaction_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "reason_code", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "reason_note", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "initiated_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "step_up_session_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "provider", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "idempotency_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
      { name: "provider_refund_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "state", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "refund_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["refund_operation_id"],
    uniqueIndexes: [
      { name: "billing_refund_operations_idempotency_key", columns: ["idempotency_key"], unique: true },
    ],
    indexes: [
      { name: "billing_refund_operations_admin_fk", columns: ["initiated_by_admin_id"], unique: false },
      { name: "billing_refund_operations_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_refund_operations_refund_fk", columns: ["refund_id"], unique: false },
      { name: "billing_refund_operations_step_up_fk", columns: ["step_up_session_id"], unique: false },
      { name: "billing_refund_operations_transaction_idx", columns: ["payment_transaction_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_refund_operations_admin_fk", columns: ["initiated_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refund_operations_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refund_operations_refund_fk", columns: ["refund_id"], referencedTable: "billing_refunds", referencedColumns: ["refund_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refund_operations_step_up_fk", columns: ["step_up_session_id"], referencedTable: "platform_admin_step_up_sessions", referencedColumns: ["step_up_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refund_operations_transaction_fk", columns: ["payment_transaction_id"], referencedTable: "billing_payment_transactions", referencedColumns: ["payment_transaction_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_refund_operations_amount_check", clause: "(`amount_minor` > 0)" },
      { name: "billing_refund_operations_reason_note_check", clause: "((`reason_note` is null) or (char_length(`reason_note`) <= 255))" },
      { name: "billing_refund_operations_state_check", clause: "(`state` in (_utf8mb4'CREATED',_utf8mb4'PROVIDER_CONFIRMED',_utf8mb4'FINALIZED',_utf8mb4'FAILED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_refunds",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "refund_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_transaction_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "reason_code", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "reason_note", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "initiated_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "step_up_session_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "entitlement_treatment", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "NOT_APPLICABLE", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed enum ('NOT_APPLICABLE','ENTITLEMENT_UNCHANGED','ENTITLEMENT_REDUCTION_PENDING')." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["refund_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "billing_refunds_admin_fk", columns: ["initiated_by_admin_id"], unique: false },
      { name: "billing_refunds_currency_fk", columns: ["currency_code"], unique: false },
      { name: "billing_refunds_step_up_fk", columns: ["step_up_session_id"], unique: false },
      { name: "billing_refunds_transaction_idx", columns: ["payment_transaction_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_refunds_admin_fk", columns: ["initiated_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refunds_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refunds_step_up_fk", columns: ["step_up_session_id"], referencedTable: "platform_admin_step_up_sessions", referencedColumns: ["step_up_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_refunds_transaction_fk", columns: ["payment_transaction_id"], referencedTable: "billing_payment_transactions", referencedColumns: ["payment_transaction_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_refunds_amount_check", clause: "(`amount_minor` > 0)" },
      { name: "billing_refunds_entitlement_treatment_check", clause: "(`entitlement_treatment` in (_utf8mb4'NOT_APPLICABLE',_utf8mb4'ENTITLEMENT_UNCHANGED',_utf8mb4'ENTITLEMENT_REDUCTION_PENDING'))" },
      { name: "billing_refunds_reason_note_check", clause: "((`reason_note` is null) or (char_length(`reason_note`) <= 255))" },
      { name: "billing_refunds_status_check", clause: "(`status` in (_utf8mb4'RECORDED',_utf8mb4'FAILED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "billing_subscriptions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0007_billing_core.sql",
    alteredByMigrations: ["0031_billing_subscription_auto_renew.sql"],
    ownerModule: "backend/src/http",
    columns: [
      { name: "subscription_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "plan_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "current_period_start", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "current_period_end", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "payment_method_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "canceled_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "auto_renew", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "active_account_key", columnType: "varchar(80)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: "(case when (`status` in (_utf8mb4'TRIALING',_utf8mb4'ACTIVE',_utf8mb4'PAST_DUE')) then `account_ref` else NULL end)", generatedStorage: "STORED", privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
    ],
    primaryKey: ["subscription_id"],
    uniqueIndexes: [
      { name: "billing_subscriptions_active_account_key", columns: ["active_account_key"], unique: true },
    ],
    indexes: [
      { name: "billing_subscriptions_account_ref_idx", columns: ["account_ref"], unique: false },
      { name: "billing_subscriptions_payment_method_fk", columns: ["payment_method_id"], unique: false },
      { name: "billing_subscriptions_plan_fk", columns: ["plan_id"], unique: false },
    ],
    foreignKeys: [
      { name: "billing_subscriptions_payment_method_fk", columns: ["payment_method_id"], referencedTable: "billing_payment_methods", referencedColumns: ["payment_method_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "billing_subscriptions_plan_fk", columns: ["plan_id"], referencedTable: "billing_plans", referencedColumns: ["plan_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "billing_subscriptions_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 64)" },
      { name: "billing_subscriptions_status_check", clause: "(`status` in (_utf8mb4'TRIALING',_utf8mb4'ACTIVE',_utf8mb4'PAST_DUE',_utf8mb4'CANCELED',_utf8mb4'EXPIRED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "account_ref", impliedReferencedTable: "parent_accounts", impliedReferencedColumn: "account_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Billing/commercial plane isolation from the family plane.", source: "backend/test/billing/schemaPrivacy.test.mjs" },
    ],
  },
  {
    name: "commercial_notifications",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0012_commercial_notifications.sql",
    alteredByMigrations: ["0033_commercial_notifications_renewal_upcoming.sql"],
    ownerModule: "backend/src/commercialmaintenance",
    columns: [
      { name: "notification_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "event_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "dedupe_key", columnType: "varchar(191)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
      { name: "resource_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "message_key", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Fixed enum-like localization key into a client-side translation table (migration 0012: 'never free-text, never a pre-rendered English sentence')." },
      { name: "params_json", columnType: "json", dataType: "json", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Server-controlled structured parameter bag (migration 0012), never free-text." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "read_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "acknowledged_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["notification_id"],
    uniqueIndexes: [
      { name: "commercial_notifications_dedupe_key", columns: ["dedupe_key"], unique: true },
    ],
    indexes: [
      { name: "commercial_notifications_account_created_idx", columns: ["account_ref", "created_at"], unique: false },
      { name: "commercial_notifications_account_unread_idx", columns: ["account_ref", "read_at"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "commercial_notifications_account_ref_check", clause: "(char_length(`account_ref`) between 1 and 128)" },
      { name: "commercial_notifications_acknowledged_after_read_check", clause: "((`acknowledged_at` is null) or (`read_at` is not null))" },
      { name: "commercial_notifications_dedupe_key_check", clause: "(char_length(`dedupe_key`) between 1 and 191)" },
      { name: "commercial_notifications_event_type_check", clause: "(`event_type` in (_utf8mb4'QUOTE_READY',_utf8mb4'PAYMENT_CONFIRMED',_utf8mb4'ENTITLEMENT_INCREASED',_utf8mb4'PAYMENT_FAILED',_utf8mb4'REQUEST_DENIED',_utf8mb4'QUOTE_EXPIRED',_utf8mb4'RENEWAL_UPCOMING'))" },
      { name: "commercial_notifications_message_key_check", clause: "(char_length(`message_key`) between 1 and 64)" },
      { name: "commercial_notifications_resource_ref_check", clause: "((`resource_ref` is null) or (char_length(`resource_ref`) between 1 and 128))" },
    ],
    applicationEnforcedRelations: [
      { column: "account_ref", impliedReferencedTable: "parent_accounts", impliedReferencedColumn: "account_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Deliberately NOT a family_id FK into the family/parent plane -- commercial/family-plane isolation, enforced by billing_core's own schemaPrivacy test.", source: "backend/migrations/0012_commercial_notifications.sql:12-18; backend/test/commercialnotifications/schemaPrivacy.test.mjs" },
    ],
  },
  {
    name: "complimentary_entitlement_grants",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0014_complimentary_entitlement_grants.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "grant_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "entitlement_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "category", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary grant category." },
      { name: "amount_or_allowance", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "effective_from", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "ACTIVE", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "reason_code", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "internal_note", columnType: "varchar(2000)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "granted_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "revision", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
    ],
    primaryKey: ["grant_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "complimentary_entitlement_grants_expiry_idx", columns: ["status", "expires_at"], unique: false },
      { name: "complimentary_entitlement_grants_family_scope_idx", columns: ["family_id", "entitlement_type", "status"], unique: false },
      { name: "complimentary_entitlement_grants_granted_by_idx", columns: ["granted_by_admin_id"], unique: false },
      { name: "complimentary_entitlement_grants_revoked_by_fk", columns: ["revoked_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "complimentary_entitlement_grants_granted_by_fk", columns: ["granted_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "complimentary_entitlement_grants_revoked_by_fk", columns: ["revoked_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "complimentary_entitlement_grants_amount_check", clause: "(`amount_or_allowance` >= 0)" },
      { name: "complimentary_entitlement_grants_category_check", clause: "(`category` in (_utf8mb4'FOUNDER',_utf8mb4'STAFF',_utf8mb4'STAFF_FAMILY',_utf8mb4'BETA_TESTER',_utf8mb4'PARTNER',_utf8mb4'PROMOTION',_utf8mb4'SUPPORT_EXCEPTION',_utf8mb4'LIFETIME_COMPLIMENTARY',_utf8mb4'TEMPORARY_COMPLIMENTARY',_utf8mb4'OTHER'))" },
      { name: "complimentary_entitlement_grants_entitlement_type_check", clause: "(`entitlement_type` in (_utf8mb4'COMMERCIAL_ACCESS',_utf8mb4'MANAGED_DEVICE_CAPACITY',_utf8mb4'PARENT_MEMBER_CAPACITY'))" },
      { name: "complimentary_entitlement_grants_expiry_order_check", clause: "((`expires_at` is null) or (`expires_at` > `effective_from`))" },
      { name: "complimentary_entitlement_grants_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "complimentary_entitlement_grants_internal_note_check", clause: "((`internal_note` is null) or (char_length(`internal_note`) <= 2000))" },
      { name: "complimentary_entitlement_grants_reason_code_check", clause: "(char_length(`reason_code`) between 1 and 64)" },
      { name: "complimentary_entitlement_grants_revoked_pair_check", clause: "((`status` <> _utf8mb4'REVOKED') or ((`revoked_at` is not null) and (`revoked_by_admin_id` is not null)))" },
      { name: "complimentary_entitlement_grants_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED',_utf8mb4'EXPIRED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "device_challenges",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "challenge_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "nonce", columnType: "varchar(256)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque encrypted/binary payload." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "consumed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["challenge_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "device_challenges_device_id_idx", columns: ["device_id"], unique: false },
    ],
    foreignKeys: [
      { name: "device_challenges_device_id_fk", columns: ["device_id"], referencedTable: "devices", referencedColumns: ["device_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "device_challenges_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "device_challenges_nonce_check", clause: "(char_length(`nonce`) between 1 and 256)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "device_protection_status",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0024_device_protection_status.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "protection_level", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["device_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "device_protection_status_family_id_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [
      { name: "device_protection_status_device_id_fk", columns: ["device_id"], referencedTable: "devices", referencedColumns: ["device_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "device_protection_status_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "device_protection_status_level_check", clause: "(`protection_level` in (_utf8mb4'STANDARD',_utf8mb4'PROTECTED',_utf8mb4'DEGRADED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'NOT_SUPPORTED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "device_public_keys",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "key_purpose", columnType: "varchar(8)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["device_id", "key_id"],
    uniqueIndexes: [
      { name: "device_public_keys_public_key_key", columns: ["public_key"], unique: true },
    ],
    indexes: [
      { name: "device_public_keys_device_id_idx", columns: ["device_id"], unique: false },
    ],
    foreignKeys: [
      { name: "device_public_keys_device_id_fk", columns: ["device_id"], referencedTable: "devices", referencedColumns: ["device_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "device_public_keys_key_purpose_check", clause: "(`key_purpose` in (_utf8mb4'DSK',_utf8mb4'DEK'))" },
      { name: "device_public_keys_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "devices",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: ["0026_browser_endpoint_registration.sql"],
    ownerModule: "backend/src/http",
    columns: [
      { name: "device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "platform", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "paired_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "paired_by_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "registered_by_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["device_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "devices_family_id_idx", columns: ["family_id"], unique: false },
      { name: "devices_paired_by_account_id_fk", columns: ["paired_by_account_id"], unique: false },
      { name: "devices_registered_by_account_id_fk", columns: ["registered_by_account_id"], unique: false },
    ],
    foreignKeys: [
      { name: "devices_paired_by_account_id_fk", columns: ["paired_by_account_id"], referencedTable: "service_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "devices_registered_by_account_id_fk", columns: ["registered_by_account_id"], referencedTable: "service_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "devices_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "devices_platform_check", clause: "(`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS',_utf8mb4'BROWSER'))" },
      { name: "devices_status_check", clause: "(`status` in (_utf8mb4'PAIRING_PENDING',_utf8mb4'PAIRED',_utf8mb4'ACTIVE',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "enrollment_administration_verifiers",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0022_enrollment_administration_persistence.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "salt_b64", columnType: "varchar(32)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "verifier_b64", columnType: "varchar(64)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "failed_attempts", columnType: "tinyint unsigned", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "locked_until", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "enrollment_administration_verifiers_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "enrollment_administration_verifiers_salt_check", clause: "(char_length(`salt_b64`) between 1 and 32)" },
      { name: "enrollment_administration_verifiers_verifier_check", clause: "(char_length(`verifier_b64`) between 1 and 64)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "enrollment_bootstrap_attempts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0003_enrollment_bootstrap_attempts.sql",
    alteredByMigrations: ["0037_enrollment_bootstrap_attempt_invitation_fk.sql"],
    ownerModule: "backend/src/db",
    columns: [
      { name: "attempt_id", columnType: "varchar(64)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "token_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "recovery_token_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "platform", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "signing_public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "encryption_public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "signing_key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "encryption_key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invitation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["attempt_id"],
    uniqueIndexes: [
      { name: "enrollment_bootstrap_attempts_recovery_token_hash_key", columns: ["recovery_token_hash"], unique: true },
    ],
    indexes: [
      { name: "enrollment_bootstrap_attempts_device_id_idx", columns: ["device_id"], unique: false },
      { name: "enrollment_bootstrap_attempts_invitation_id_idx", columns: ["invitation_id"], unique: false },
      { name: "enrollment_bootstrap_attempts_token_hash_idx", columns: ["token_hash"], unique: false },
    ],
    foreignKeys: [
      { name: "enrollment_bootstrap_attempts_device_id_fk", columns: ["device_id"], referencedTable: "devices", referencedColumns: ["device_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "enrollment_bootstrap_attempts_invitation_id_fk", columns: ["invitation_id"], referencedTable: "enrollment_invitations", referencedColumns: ["invitation_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "enrollment_bootstrap_attempts_attempt_id_check", clause: "(char_length(`attempt_id`) between 16 and 64)" },
      { name: "enrollment_bootstrap_attempts_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "enrollment_bootstrap_attempts_platform_check", clause: "(`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))" },
      { name: "enrollment_bootstrap_attempts_recovery_token_hash_check", clause: "regexp_like(`recovery_token_hash`,_ascii'^[0-9a-f]{64}$')" },
      { name: "enrollment_bootstrap_attempts_status_check", clause: "(`status` = _utf8mb4'COMPLETED')" },
      { name: "enrollment_bootstrap_attempts_token_hash_check", clause: "regexp_like(`token_hash`,_ascii'^[0-9a-f]{64}$')" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "enrollment_invitation_transitions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0016_invitation_lifecycle_states.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/invitation",
    columns: [
      { name: "transition_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invitation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "from_status", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "to_status", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "transitioned_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["transition_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "enrollment_invitation_transitions_invitation_idx", columns: ["invitation_id", "transitioned_at"], unique: false },
    ],
    foreignKeys: [
      { name: "enrollment_invitation_transitions_invitation_fk", columns: ["invitation_id"], referencedTable: "enrollment_invitations", referencedColumns: ["invitation_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "enrollment_invitation_transitions_from_status_check", clause: "(`from_status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))" },
      { name: "enrollment_invitation_transitions_to_status_check", clause: "(`to_status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "enrollment_invitations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: ["0016_invitation_lifecycle_states.sql", "0019_enrollment_profile_contract.sql"],
    ownerModule: "backend/src/enrollment",
    columns: [
      { name: "invitation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "child_profile_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "token_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "platform", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "requested_protection_mode", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "age_ux_tier", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "YOUNG_CHILD", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed enum ('YOUNG_CHILD','TEEN') UX tier, not an actual age/DOB (migration 0019: 'No display name, activity, location, or readable child content is stored here')." },
      { name: "initial_policy_profile", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "BALANCED", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed enum ('BALANCED','STRICT') named tier selection, not stored policy/rule content." },
      { name: "status", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "opened_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "install_required_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "app_installed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "authorization_required_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "redeemed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expired_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["invitation_id"],
    uniqueIndexes: [
      { name: "enrollment_invitations_token_hash_key", columns: ["token_hash"], unique: true },
    ],
    indexes: [
      { name: "enrollment_invitations_family_child_idx", columns: ["family_id", "child_profile_id"], unique: false },
      { name: "enrollment_invitations_family_id_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "enrollment_invitations_age_ux_tier_check", clause: "(`age_ux_tier` in (_utf8mb4'YOUNG_CHILD',_utf8mb4'TEEN'))" },
      { name: "enrollment_invitations_child_profile_id_check", clause: "((`child_profile_id` is null) or regexp_like(`child_profile_id`,_utf8mb4'^[A-Za-z0-9_-]{1,128}$'))" },
      { name: "enrollment_invitations_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "enrollment_invitations_initial_policy_profile_check", clause: "(`initial_policy_profile` in (_utf8mb4'BALANCED',_utf8mb4'STRICT'))" },
      { name: "enrollment_invitations_platform_check", clause: "(`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS'))" },
      { name: "enrollment_invitations_protection_mode_check", clause: "(`requested_protection_mode` in (_utf8mb4'ANDROID_STANDARD',_utf8mb4'ANDROID_PROTECTED',_utf8mb4'IOS_STANDARD'))" },
      { name: "enrollment_invitations_status_check", clause: "(`status` in (_utf8mb4'CREATED',_utf8mb4'OPENED',_utf8mb4'INSTALL_REQUIRED',_utf8mb4'APP_INSTALLED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'REDEEMED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))" },
      { name: "enrollment_invitations_token_hash_check", clause: "regexp_like(`token_hash`,_ascii'^[0-9a-f]{64}$')" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "child_profile_id", impliedReferencedTable: "family_child_memberships", impliedReferencedColumn: "child_profile_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Relationship enforced at the application layer (InvitationService) because enrollment_invitations already carries pre-registry fixture rows this table cannot retroactively host without risking a false cross-family bind.", source: "backend/migrations/0036_family_child_memberships.sql:24-33; docs/pre-production/PCA_PPR2_OWNER_DECISIONS.md Part F" },
    ],
  },
  {
    name: "enrollment_protection_approval_requests",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0022_enrollment_administration_persistence.sql",
    alteredByMigrations: ["0023_removal_decision_authority_persistence.sql"],
    ownerModule: "backend/src/db",
    columns: [
      { name: "request_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "child_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "device_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "operation", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed enum ('REMOVE_REVOKE_DEVICE','DISABLE_PROTECTION_POLICY')." },
      { name: "protection_level", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "requested_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "reason_category", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "protective_authority_applies", columnType: "tinyint unsigned", dataType: "tinyint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "state", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "decided_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "decision_method", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "temporary_disable_until", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "decided_by_device_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "decision_action_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "idempotency_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
      { name: "decision_fingerprint", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
    ],
    primaryKey: ["request_id"],
    uniqueIndexes: [
      { name: "enrollment_protection_approval_decision_action_uq", columns: ["decision_action_id"], unique: true },
    ],
    indexes: [
      { name: "enrollment_protection_approval_family_state_idx", columns: ["family_id", "state", "expires_at"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "enrollment_protection_approval_authority_check", clause: "(`protective_authority_applies` = 1)" },
      { name: "enrollment_protection_approval_child_id_check", clause: "(char_length(`child_id`) between 1 and 200)" },
      { name: "enrollment_protection_approval_decided_device_check", clause: "((`decided_by_device_id` is null) or (char_length(`decided_by_device_id`) between 1 and 200))" },
      { name: "enrollment_protection_approval_decision_action_check", clause: "((`decision_action_id` is null) or (char_length(`decision_action_id`) between 1 and 128))" },
      { name: "enrollment_protection_approval_device_id_check", clause: "(char_length(`device_id`) between 1 and 200)" },
      { name: "enrollment_protection_approval_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "enrollment_protection_approval_fingerprint_check", clause: "((`decision_fingerprint` is null) or (char_length(`decision_fingerprint`) = 64))" },
      { name: "enrollment_protection_approval_idempotency_check", clause: "((`idempotency_key` is null) or (char_length(`idempotency_key`) between 1 and 128))" },
      { name: "enrollment_protection_approval_level_check", clause: "(`protection_level` in (_utf8mb4'STANDARD',_utf8mb4'PROTECTED',_utf8mb4'DEGRADED',_utf8mb4'AUTHORIZATION_REQUIRED',_utf8mb4'NOT_SUPPORTED'))" },
      { name: "enrollment_protection_approval_method_check", clause: "((`decision_method` is null) or (`decision_method` in (_utf8mb4'REMOTE_PARENT',_utf8mb4'LOCAL_ADMINISTRATION_PIN',_utf8mb4'AUTHORIZED_RECOVERY')))" },
      { name: "enrollment_protection_approval_operation_check", clause: "(`operation` in (_utf8mb4'REMOVE_REVOKE_DEVICE',_utf8mb4'DISABLE_PROTECTION_POLICY'))" },
      { name: "enrollment_protection_approval_reason_check", clause: "((`reason_category` is null) or (`reason_category` in (_utf8mb4'ROUTINE_POLICY_CHANGE',_utf8mb4'CHILD_SAFETY_CONCERN',_utf8mb4'DEVICE_LOST_OR_STOLEN',_utf8mb4'FAMILY_MEMBERSHIP_CHANGE',_utf8mb4'RECOVERY',_utf8mb4'OTHER')))" },
      { name: "enrollment_protection_approval_state_check", clause: "(`state` in (_utf8mb4'PARENT_APPROVAL_REQUIRED',_utf8mb4'KEEP_ACTIVE',_utf8mb4'TEMPORARILY_DISABLE',_utf8mb4'ALLOW_REMOVAL'))" },
      { name: "enrollment_protection_approval_window_check", clause: "(`expires_at` > `requested_at`)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Table stores opaque child/device references, not a DB-joinable identity.", source: "backend/migrations/0022_enrollment_administration_persistence.sql:1-8" },
      { column: "decided_by_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Same opaque-reference design as device_id on this table.", source: "backend/migrations/0022_enrollment_administration_persistence.sql:1-8" },
      { column: "child_id", impliedReferencedTable: "family_child_memberships", impliedReferencedColumn: "child_profile_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Table stores opaque child/device references by design.", source: "backend/migrations/0022_enrollment_administration_persistence.sql:1-8" },
    ],
  },
  {
    name: "entitlement_activation_idempotency",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "idempotency_key", columnType: "varchar(191)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Idempotency/dedup/uniqueness key, opaque." },
      { name: "request_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "applied_managed_device_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "applied_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["idempotency_key"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "entitlement_activation_idempotency_request_id_idx", columns: ["request_id"], unique: false },
    ],
    foreignKeys: [
      { name: "entitlement_activation_idempotency_request_id_fk", columns: ["request_id"], referencedTable: "entitlement_change_requests", referencedColumns: ["request_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "entitlement_activation_idempotency_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "entitlement_activation_idempotency_limit_check", clause: "(`applied_managed_device_limit` >= 0)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "entitlement_change_request_transitions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "transition_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "request_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "from_state", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "to_state", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "occurred_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "actor_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["transition_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "entitlement_change_request_transitions_actor_admin_id_fk", columns: ["actor_admin_id"], unique: false },
      { name: "entitlement_change_request_transitions_request_id_idx", columns: ["request_id"], unique: false },
    ],
    foreignKeys: [
      { name: "entitlement_change_request_transitions_actor_admin_id_fk", columns: ["actor_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "entitlement_change_request_transitions_request_id_fk", columns: ["request_id"], referencedTable: "entitlement_change_requests", referencedColumns: ["request_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "entitlement_change_request_transitions_from_state_check", clause: "((`from_state` is null) or (`from_state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED')))" },
      { name: "entitlement_change_request_transitions_to_state_check", clause: "(`to_state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "entitlement_change_requests",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "request_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "limit_type", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "current_limit_at_request", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "target_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "state", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "awaiting_admin_quote", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "no_charge_override", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "quote_kind", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "quote_ref", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "quote_amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "quote_currency_code", columnType: "char(3)", dataType: "char", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "quote_price_book_version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "quoted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "quote_expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "decided_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "decision_reason", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["request_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "entitlement_change_requests_decided_by_admin_id_fk", columns: ["decided_by_admin_id"], unique: false },
      { name: "entitlement_change_requests_family_id_idx", columns: ["family_id"], unique: false },
      { name: "entitlement_change_requests_state_idx", columns: ["state"], unique: false },
    ],
    foreignKeys: [
      { name: "entitlement_change_requests_decided_by_admin_id_fk", columns: ["decided_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "entitlement_change_requests_billable_check", clause: "((`limit_type` <> _utf8mb4'PARENT_MEMBER_LIMIT') or (`quote_kind` is null))" },
      { name: "entitlement_change_requests_currency_code_check", clause: "((`quote_currency_code` is null) or regexp_like(`quote_currency_code`,_utf8mb4'^[A-Z]{3}$'))" },
      { name: "entitlement_change_requests_current_limit_check", clause: "(`current_limit_at_request` >= 0)" },
      { name: "entitlement_change_requests_decision_reason_check", clause: "((`decision_reason` is null) or (char_length(`decision_reason`) between 1 and 255))" },
      { name: "entitlement_change_requests_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "entitlement_change_requests_limit_type_check", clause: "(`limit_type` in (_utf8mb4'PARENT_MEMBER_LIMIT',_utf8mb4'MANAGED_DEVICE_LIMIT'))" },
      { name: "entitlement_change_requests_price_book_version_check", clause: "((`quote_price_book_version` is null) or (`quote_price_book_version` > 0))" },
      { name: "entitlement_change_requests_quote_amount_check", clause: "((`quote_amount_minor` is null) or (`quote_amount_minor` >= 0))" },
      { name: "entitlement_change_requests_quote_kind_check", clause: "((`quote_kind` is null) or (`quote_kind` in (_utf8mb4'STANDARD',_utf8mb4'CUSTOM')))" },
      { name: "entitlement_change_requests_state_check", clause: "(`state` in (_utf8mb4'PENDING',_utf8mb4'QUOTED',_utf8mb4'PAYMENT_PENDING',_utf8mb4'APPROVED',_utf8mb4'DENIED',_utf8mb4'CANCELLED'))" },
      { name: "entitlement_change_requests_target_limit_check", clause: "(`target_limit` >= 0)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "quote_ref", impliedReferencedTable: "billing_quotes", impliedReferencedColumn: "quote_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Same billing/entitlements plane-isolation convention, reverse direction.", source: "backend/src/billing/entitlementContract.ts:21" },
    ],
  },
  {
    name: "entitlement_defaults",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/entitlements",
    columns: [
      { name: "tier", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary plan tier code." },
      { name: "parent_member_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "managed_device_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["tier"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "entitlement_defaults_updated_by_admin_id_fk", columns: ["updated_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "entitlement_defaults_updated_by_admin_id_fk", columns: ["updated_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "entitlement_defaults_managed_device_limit_check", clause: "(`managed_device_limit` >= 0)" },
      { name: "entitlement_defaults_parent_member_limit_check", clause: "(`parent_member_limit` >= 0)" },
      { name: "entitlement_defaults_tier_check", clause: "(`tier` = _utf8mb4'FREE_STARTER')" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "envelope_data_version_ledger",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0002_sync_durability.sql",
    alteredByMigrations: ["0004_envelope_ledger_family_scope.sql"],
    ownerModule: "backend/src/familyenvelope",
    columns: [
      { name: "sender_key_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "last_accepted_version", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id", "sender_key_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "envelope_data_version_ledger_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "envelope_data_version_ledger_sender_key_id_check", clause: "(char_length(`sender_key_id`) between 1 and 128)" },
      { name: "envelope_data_version_ledger_version_check", clause: "regexp_like(`last_accepted_version`,_utf8mb4'^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)$')" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "envelope_message_idempotency_ledger",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0002_sync_durability.sql",
    alteredByMigrations: ["0004_envelope_ledger_family_scope.sql"],
    ownerModule: "backend/src/familyenvelope",
    columns: [
      { name: "id", columnType: "bigint unsigned", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: true, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "message_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque bounded application identifier, not message content." },
      { name: "canonical_bytes", columnType: "mediumblob", dataType: "mediumblob", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque canonical envelope bytes (migration 0002): authenticated-encrypted payload, never plaintext." },
      { name: "recorded_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["id"],
    uniqueIndexes: [
      { name: "envelope_message_idempotency_ledger_family_message_key", columns: ["family_id", "message_id"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "envelope_message_idempotency_ledger_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "envelope_message_idempotency_ledger_message_id_check", clause: "(char_length(`message_id`) between 1 and 128)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "envelope_replay_ledger",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0002_sync_durability.sql",
    alteredByMigrations: ["0004_envelope_ledger_family_scope.sql"],
    ownerModule: "backend/src/familyenvelope",
    columns: [
      { name: "id", columnType: "bigint unsigned", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: true, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "sender_key_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "sequence_or_nonce", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Anti-replay sequence/nonce value." },
      { name: "recorded_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["id"],
    uniqueIndexes: [
      { name: "envelope_replay_ledger_family_sender_sequence_key", columns: ["family_id", "sender_key_id", "sequence_or_nonce"], unique: true },
    ],
    indexes: [
      { name: "envelope_replay_ledger_family_sender_id_idx", columns: ["family_id", "sender_key_id", "id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "envelope_replay_ledger_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "envelope_replay_ledger_sender_key_id_check", clause: "(char_length(`sender_key_id`) between 1 and 128)" },
      { name: "envelope_replay_ledger_sequence_or_nonce_check", clause: "(char_length(`sequence_or_nonce`) between 1 and 128)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "eye_protection_settings",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0032_eye_protection_settings.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "child_profile_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "reminders_enabled", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent-set boolean preference (migration 0032); no sensor/distance/proximity data." },
      { name: "updated_at", columnType: "datetime(6)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["child_profile_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "eye_protection_settings_family_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "eye_protection_settings_reminders_enabled_check", clause: "(`reminders_enabled` in (0,1))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "child_profile_id", impliedReferencedTable: "family_child_memberships", impliedReferencedColumn: "child_profile_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Same soft-reference convention as enrollment_invitations.child_profile_id, by direct extension (created migration 0032, using the identical type established by 0019, before the registry existed).", source: "backend/migrations/0036_family_child_memberships.sql:24-33 (by extension)" },
    ],
  },
  {
    name: "families",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: ["0017_platform_admin_settings_family_status.sql"],
    ownerModule: "backend/src/http",
    columns: [
      { name: "family_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_reference_hash", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "ACTIVE", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "deleted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "suspended_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "suspended_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "suspension_reason", columnType: "varchar(500)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [
      { name: "families_family_reference_hash_key", columns: ["family_reference_hash"], unique: true },
    ],
    indexes: [
      { name: "families_status_idx", columns: ["status"], unique: false },
      { name: "families_suspended_by_fk", columns: ["suspended_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "families_suspended_by_fk", columns: ["suspended_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "families_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'SUSPENDED'))" },
      { name: "families_suspension_pair_check", clause: "(((`status` = _utf8mb4'SUSPENDED') and (`suspended_at` is not null) and (`suspended_by_admin_id` is not null) and (`suspension_reason` is not null)) or ((`status` = _utf8mb4'ACTIVE') and (`suspended_at` is null) and (`suspended_by_admin_id` is null) and (`suspension_reason` is null)))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "family_audit_events",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0028_family_audit_events.sql",
    alteredByMigrations: ["0034_audit_alert_ciphertext_expiry.sql"],
    ownerModule: "backend/src/db",
    columns: [
      { name: "envelope_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "parent_device_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "key_epoch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "generated_at_utc", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "encrypted_payload_b64", columnType: "mediumtext", dataType: "mediumtext", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque ciphertext (migration 0028): never a readable actionType/targetScope/reasonCategory value server-side." },
      { name: "nonce_b64", columnType: "varchar(64)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "AEAD nonce for the ciphertext column." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "1970-01-01 00:00:00.000", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["envelope_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "family_audit_events_expires_at_idx", columns: ["expires_at"], unique: false },
      { name: "family_audit_events_family_idx", columns: ["family_id", "generated_at_utc"], unique: false },
      { name: "family_audit_events_parent_device_idx", columns: ["family_id", "parent_device_id", "generated_at_utc"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "family_audit_events_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "family_audit_events_key_epoch_check", clause: "(`key_epoch` >= 0)" },
      { name: "family_audit_events_nonce_check", clause: "(char_length(`nonce_b64`) between 1 and 64)" },
      { name: "family_audit_events_parent_device_id_check", clause: "(char_length(`parent_device_id`) between 1 and 200)" },
      { name: "family_audit_events_payload_check", clause: "(char_length(`encrypted_payload_b64`) between 1 and 4194304)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "parent_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque ciphertext + typed routing metadata only, never a readable value; mirrors protection_alerts exactly.", source: "backend/migrations/0028_family_audit_events.sql:1-14" },
    ],
  },
  {
    name: "family_authority_attestations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0011_family_commercial_authority.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "attestation_id", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "attestation_revision", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "owner_device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "owner_dsk_key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "owner_dsk_public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "trust_set_epoch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "key_epoch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "issued_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "previous_attestation_id", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "signer_device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "signer_dsk_key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "signer_dsk_public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "signature", columnType: "varchar(512)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Cryptographic signature, opaque to the schema." },
    ],
    primaryKey: ["family_id", "attestation_id"],
    uniqueIndexes: [
      { name: "family_authority_attestations_family_revision_key", columns: ["family_id", "attestation_revision"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [
      { name: "family_authority_attestations_genesis_fk", columns: ["family_id"], referencedTable: "family_authority_genesis_anchors", referencedColumns: ["family_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "family_authority_attestations_revision_check", clause: "(`attestation_revision` >= 1)" },
      { name: "family_authority_attestations_ttl_check", clause: "(`expires_at` > `issued_at`)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "owner_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Cryptographic self-certification substitutes for DB referential integrity.", source: "backend/migrations/0011_family_commercial_authority.sql:6-16" },
      { column: "signer_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Cryptographic self-certification substitutes for DB referential integrity.", source: "backend/migrations/0011_family_commercial_authority.sql:6-16" },
      { column: "previous_attestation_id", impliedReferencedTable: "family_authority_attestations", impliedReferencedColumn: "attestation_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Self-referential hash-chain pointer; chain integrity is verified by signature, not FK.", source: "backend/migrations/0011_family_commercial_authority.sql:6-16" },
    ],
  },
  {
    name: "family_authority_chain_heads",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0011_family_commercial_authority.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "head_attestation_id", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "head_revision", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "family_authority_chain_heads_attestation_fk", columns: ["family_id", "head_attestation_id"], unique: false },
    ],
    foreignKeys: [
      { name: "family_authority_chain_heads_attestation_fk", columns: ["family_id", "head_attestation_id"], referencedTable: "family_authority_attestations", referencedColumns: ["family_id", "attestation_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "family_authority_chain_heads_genesis_fk", columns: ["family_id"], referencedTable: "family_authority_genesis_anchors", referencedColumns: ["family_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "family_authority_chain_heads_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "family_authority_genesis_anchors",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0011_family_commercial_authority.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "genesis_device_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "genesis_dsk_key_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "genesis_dsk_public_key", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Public signing key material (never private)." },
      { name: "protocol_version", columnType: "smallint unsigned", dataType: "smallint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "signature", columnType: "varchar(512)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Cryptographic self-signature, opaque to the schema." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "family_authority_genesis_anchors_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "family_authority_genesis_anchors_protocol_version_check", clause: "(`protocol_version` between 1 and 100)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "genesis_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Integrity is cryptographic (signature verification by FamilyOwnerAttestationChainEngine), not referential; a dangling id would fail signature verification before being written.", source: "backend/migrations/0011_family_commercial_authority.sql:6-16" },
    ],
  },
  {
    name: "family_child_memberships",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0036_family_child_memberships.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/childprofiles",
    columns: [
      { name: "child_profile_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Server-minted UUID, membership/existence edge only (migration 0036 / doc 10 Section 7.1) -- never a ChildProfile record." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "creation_request_key", columnType: "varchar(191)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Caller-supplied idempotency key, never used as row identity." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["child_profile_id"],
    uniqueIndexes: [
      { name: "family_child_memberships_family_creation_key", columns: ["family_id", "creation_request_key"], unique: true },
    ],
    indexes: [
      { name: "family_child_memberships_family_id_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "family_child_memberships_child_profile_id_check", clause: "regexp_like(`child_profile_id`,_utf8mb4'^[A-Za-z0-9_-]{1,128}$')" },
      { name: "family_child_memberships_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "family_member_invitations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0027_family_member_invitations.sql",
    alteredByMigrations: ["0035_family_member_invitation_pending_uniqueness.sql"],
    ownerModule: "backend/src/familymembers",
    columns: [
      { name: "invitation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invited_email_hash", columnType: "binary(32)", dataType: "binary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "role", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "invited_by_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "accepted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expired_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "accepted_by_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "pending_invited_email_hash", columnType: "binary(32)", dataType: "binary", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: "(case when (`status` = _utf8mb4'PENDING') then `invited_email_hash` else NULL end)", generatedStorage: "STORED", privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
    ],
    primaryKey: ["invitation_id"],
    uniqueIndexes: [
      { name: "family_member_invitations_pending_email_key", columns: ["family_id", "pending_invited_email_hash"], unique: true },
    ],
    indexes: [
      { name: "family_member_invitations_email_hash_idx", columns: ["invited_email_hash"], unique: false },
      { name: "family_member_invitations_family_id_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "family_member_invitations_role_check", clause: "(`role` in (_utf8mb4'ADMINISTRATOR',_utf8mb4'VIEWER'))" },
      { name: "family_member_invitations_status_check", clause: "(`status` in (_utf8mb4'PENDING',_utf8mb4'ACCEPTED',_utf8mb4'EXPIRED',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "family_rbac_policy_config",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0027_family_member_invitations.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "administrator_can_manage_viewers", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "administrator_can_revoke_device_or_disable_protection", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "licenses",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/authz",
    columns: [
      { name: "license_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "license_reference_hash", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["license_id"],
    uniqueIndexes: [
      { name: "licenses_license_reference_hash_key", columns: ["license_reference_hash"], unique: true },
    ],
    indexes: [
      { name: "licenses_account_id_idx", columns: ["account_id"], unique: false },
    ],
    foreignKeys: [
      { name: "licenses_account_id_fk", columns: ["account_id"], referencedTable: "service_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "licenses_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'SUSPENDED',_utf8mb4'EXPIRED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "managed_device_slot_reservations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0006_platform_entitlements_enrollment_limits.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "reservation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "invitation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "consumed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "released_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "release_reason", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
    ],
    primaryKey: ["reservation_id"],
    uniqueIndexes: [
      { name: "managed_device_slot_reservations_invitation_id_key", columns: ["invitation_id"], unique: true },
    ],
    indexes: [
      { name: "managed_device_slot_reservations_family_id_status_idx", columns: ["family_id", "status"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "managed_device_slot_reservations_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "managed_device_slot_reservations_release_reason_check", clause: "((`release_reason` is null) or (`release_reason` in (_utf8mb4'REVOKED',_utf8mb4'EXPIRED',_utf8mb4'ENROLLMENT_FAILED',_utf8mb4'ADMIN_ACTION')))" },
      { name: "managed_device_slot_reservations_status_check", clause: "(`status` in (_utf8mb4'RESERVED',_utf8mb4'CONSUMED',_utf8mb4'RELEASED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "invitation_id", impliedReferencedTable: "enrollment_invitations", impliedReferencedColumn: "invitation_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "DELIBERATELY not foreign-keyed: the reservation must be created and committed BEFORE the invitation it is bound to is ever persisted (reserve first, only create a usable invitation if the reservation succeeds).", source: "backend/migrations/0006_platform_entitlements_enrollment_limits.sql:219-222" },
    ],
  },
  {
    name: "parent_account_preferences",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0020_parent_preferences_safe_zones.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "account_id", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "language_code", columnType: "varchar(2)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "en", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent's own UI language preference." },
      { name: "email_alerts_enabled", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "push_requests_enabled", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "email_destination", columnType: "varchar(320)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent's own controlled-email destination address (migration 0020's PCA-FR-094)." },
      { name: "email_destination_state", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "UNVERIFIED", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "updated_at", columnType: "datetime(6)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["account_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "parent_account_preferences_email_check", clause: "(`email_alerts_enabled` in (0,1))" },
      { name: "parent_account_preferences_email_state_check", clause: "(`email_destination_state` in (_utf8mb4'UNVERIFIED',_utf8mb4'VERIFIED'))" },
      { name: "parent_account_preferences_language_check", clause: "(`language_code` in (_utf8mb4'en',_utf8mb4'ar'))" },
      { name: "parent_account_preferences_push_check", clause: "(`push_requests_enabled` in (0,1))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "parent_accounts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0013_parent_account_identity.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/familymembers",
    columns: [
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "email_hash", columnType: "binary(32)", dataType: "binary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "password_hash", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ACCOUNT_AUTH", privacyNote: "Password/credential material." },
      { name: "status", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "PENDING_VERIFICATION", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "family_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "service_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "free_access_mode", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "free_access_duration_days", columnType: "int", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "free_access_started_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "free_access_expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "default_parent_member_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "default_managed_device_limit", columnType: "int", dataType: "int", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "verified_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "disabled_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["account_id"],
    uniqueIndexes: [
      { name: "parent_accounts_email_hash_key", columns: ["email_hash"], unique: true },
      { name: "parent_accounts_service_account_id_key", columns: ["service_account_id"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "parent_accounts_free_access_mode_check", clause: "((`free_access_mode` is null) or (`free_access_mode` in (_utf8mb4'TIME_LIMITED',_utf8mb4'PERPETUAL')))" },
      { name: "parent_accounts_status_check", clause: "(`status` in (_utf8mb4'PENDING_VERIFICATION',_utf8mb4'VERIFIED'))" },
      { name: "parent_accounts_time_limited_has_duration_check", clause: "((`free_access_mode` <> _utf8mb4'TIME_LIMITED') or (`free_access_duration_days` is not null))" },
      { name: "parent_accounts_verified_has_free_access_check", clause: "(((`status` = _utf8mb4'PENDING_VERIFICATION') and (`verified_at` is null) and (`free_access_mode` is null)) or ((`status` = _utf8mb4'VERIFIED') and (`verified_at` is not null) and (`free_access_mode` is not null)))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "parent_email_verification_codes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0013_parent_account_identity.sql",
    alteredByMigrations: ["0030_verification_code_credential_binding.sql"],
    ownerModule: "backend/src/db",
    columns: [
      { name: "code_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "code_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "password_hash", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ACCOUNT_AUTH", privacyNote: "Password/credential material." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "consumed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "attempt_count", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
    ],
    primaryKey: ["code_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "parent_email_verification_codes_account_idx", columns: ["account_id", "created_at"], unique: false },
    ],
    foreignKeys: [
      { name: "parent_email_verification_codes_account_fk", columns: ["account_id"], referencedTable: "parent_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "parent_password_reset_codes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0029_parent_password_reset_codes.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/parentaccount",
    columns: [
      { name: "code_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "code_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "consumed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "attempt_count", columnType: "int", dataType: "int", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
    ],
    primaryKey: ["code_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "parent_password_reset_codes_account_idx", columns: ["account_id", "created_at"], unique: false },
    ],
    foreignKeys: [
      { name: "parent_password_reset_codes_account_fk", columns: ["account_id"], referencedTable: "parent_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_accounts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "email_hash", columnType: "varbinary(32)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "display_name", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OTHER", privacyNote: "Platform Admin staff member's own chosen display name -- not a parent or child; not central child/family data." },
      { name: "password_credential", columnType: "varchar(255)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ACCOUNT_AUTH", privacyNote: "Password/credential material." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "disabled_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["admin_id"],
    uniqueIndexes: [
      { name: "platform_admin_accounts_email_hash_key", columns: ["email_hash"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "platform_admin_accounts_display_name_check", clause: "(char_length(`display_name`) between 1 and 128)" },
      { name: "platform_admin_accounts_password_credential_check", clause: "(char_length(`password_credential`) between 1 and 255)" },
      { name: "platform_admin_accounts_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'DISABLED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_audit_events",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: ["0014_complimentary_entitlement_grants.sql", "0015_settlement_reconciliation.sql"],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "event_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "event_type", columnType: "varchar(40)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "actor_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "actor_role", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "target_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "result", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "occurred_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "correlation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "metadata_json", columnType: "json", dataType: "json", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Platform Admin internal structured JSON (audit metadata / settings value) — not schema-constrained; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
    ],
    primaryKey: ["event_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "platform_admin_audit_events_actor_admin_id_idx", columns: ["actor_admin_id"], unique: false },
      { name: "platform_admin_audit_events_event_type_idx", columns: ["event_type"], unique: false },
      { name: "platform_admin_audit_events_occurred_at_idx", columns: ["occurred_at"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_audit_events_actor_admin_id_fk", columns: ["actor_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_audit_events_actor_role_check", clause: "((`actor_role` is null) or (`actor_role` in (_utf8mb4'APP_OWNER',_utf8mb4'PLATFORM_ADMIN',_utf8mb4'FINANCE_ADMIN',_utf8mb4'SUPPORT_ADMIN',_utf8mb4'AUDITOR_READ_ONLY')))" },
      { name: "platform_admin_audit_events_event_type_check", clause: "(`event_type` in (_utf8mb4'ADMIN_LOGIN',_utf8mb4'ADMIN_LOGIN_FAILED',_utf8mb4'ADMIN_CREATED',_utf8mb4'ADMIN_ROLE_CHANGED',_utf8mb4'ACCOUNT_SUSPENDED',_utf8mb4'ACCOUNT_REACTIVATED',_utf8mb4'DEVICE_LIMIT_CHANGED',_utf8mb4'LIMIT_REQUEST_APPROVED',_utf8mb4'LIMIT_REQUEST_DENIED',_utf8mb4'PLAN_CHANGED',_utf8mb4'PAYMENT_REFUNDED',_utf8mb4'BANK_SETTING_CHANGED',_utf8mb4'SETTING_CHANGED',_utf8mb4'PRICE_BOOK_CHANGED',_utf8mb4'QUOTE_ISSUED',_utf8mb4'PAYMENT_CONFIRMED',_utf8mb4'ENTITLEMENT_INCREASED',_utf8mb4'PAYMENT_ROLLED_BACK',_utf8mb4'ADMIN_SESSION_REVOKED',_utf8mb4'ADMIN_LOGIN_LOCKED_OUT',_utf8mb4'ADMIN_STEP_UP_GRANTED',_utf8mb4'ADMIN_STEP_UP_DENIED',_utf8mb4'ADMIN_MFA_ENROLLED',_utf8mb4'COMPLIMENTARY_GRANT_CREATED',_utf8mb4'COMPLIMENTARY_GRANT_CHANGED',_utf8mb4'COMPLIMENTARY_GRANT_REVOKED',_utf8mb4'COMPLIMENTARY_GRANT_EXPIRED',_utf8mb4'SETTLEMENT_ACCOUNT_CREATED',_utf8mb4'SETTLEMENT_ACCOUNT_CHANGED',_utf8mb4'SETTLEMENT_BATCH_CREATED',_utf8mb4'SETTLEMENT_BATCH_ITEM_ATTRIBUTED',_utf8mb4'SETTLEMENT_RECONCILIATION_RESOLVED'))" },
      { name: "platform_admin_audit_events_result_check", clause: "(`result` in (_utf8mb4'SUCCESS',_utf8mb4'FAILURE',_utf8mb4'DENIED'))" },
      { name: "platform_admin_audit_events_target_ref_check", clause: "((`target_ref` is null) or (char_length(`target_ref`) between 1 and 128))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_login_attempts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "attempt_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "email_hash", columnType: "varbinary(32)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "outcome", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "occurred_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["attempt_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "platform_admin_login_attempts_email_hash_occurred_at_idx", columns: ["email_hash", "occurred_at"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "platform_admin_login_attempts_outcome_check", clause: "(`outcome` in (_utf8mb4'SUCCESS',_utf8mb4'FAILED_CREDENTIALS',_utf8mb4'FAILED_MFA',_utf8mb4'LOCKED_OUT'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_mfa_state",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "totp_secret_ciphertext", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "totp_secret_nonce", columnType: "varbinary(16)", dataType: "varbinary", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "activated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "last_accepted_totp_counter", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
    ],
    primaryKey: ["admin_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [
      { name: "platform_admin_mfa_state_admin_id_fk", columns: ["admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_mfa_state_status_check", clause: "(`status` in (_utf8mb4'PENDING_SETUP',_utf8mb4'ACTIVE',_utf8mb4'DISABLED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_role_assignments",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "assignment_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "role", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "granted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "granted_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "active_role_marker", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: "(case when (`revoked_at` is null) then `role` else NULL end)", generatedStorage: "STORED", privacy: "OPERATIONAL_METADATA", privacyNote: "Uniqueness-marker value (supports 'at most one active role per admin'-style partial-unique index), not personal data." },
    ],
    primaryKey: ["assignment_id"],
    uniqueIndexes: [
      { name: "platform_admin_role_assignments_admin_active_key", columns: ["admin_id", "active_role_marker"], unique: true },
    ],
    indexes: [
      { name: "platform_admin_role_assignments_admin_id_idx", columns: ["admin_id"], unique: false },
      { name: "platform_admin_role_assignments_granted_by_fk", columns: ["granted_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_role_assignments_admin_id_fk", columns: ["admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "platform_admin_role_assignments_granted_by_fk", columns: ["granted_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_role_assignments_role_check", clause: "(`role` in (_utf8mb4'APP_OWNER',_utf8mb4'PLATFORM_ADMIN',_utf8mb4'FINANCE_ADMIN',_utf8mb4'SUPPORT_ADMIN',_utf8mb4'AUDITOR_READ_ONLY'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_security_alerts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0021_platform_admin_security_alerts.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "alert_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "recipient_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "source_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "kind", columnType: "varchar(20)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "occurred_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "correlation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "delivery_state", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "PENDING", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "delivered_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["alert_id"],
    uniqueIndexes: [
      { name: "platform_admin_security_alerts_correlation_recipient_key", columns: ["correlation_id", "recipient_admin_id"], unique: true },
    ],
    indexes: [
      { name: "platform_admin_security_alerts_recipient_state_idx", columns: ["recipient_admin_id", "delivery_state", "occurred_at"], unique: false },
      { name: "platform_admin_security_alerts_source_fk", columns: ["source_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_security_alerts_recipient_fk", columns: ["recipient_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "platform_admin_security_alerts_source_fk", columns: ["source_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_security_alerts_delivery_state_check", clause: "(`delivery_state` in (_utf8mb4'PENDING',_utf8mb4'DELIVERED'))" },
      { name: "platform_admin_security_alerts_delivery_timestamp_check", clause: "(((`delivery_state` = _utf8mb4'PENDING') and (`delivered_at` is null)) or ((`delivery_state` = _utf8mb4'DELIVERED') and (`delivered_at` is not null)))" },
      { name: "platform_admin_security_alerts_kind_check", clause: "(`kind` in (_utf8mb4'LOGIN_FAILED',_utf8mb4'LOCKED_OUT'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_sessions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "session_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "token_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "realm", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "issued_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["session_id"],
    uniqueIndexes: [
      { name: "platform_admin_sessions_token_hash_key", columns: ["token_hash"], unique: true },
    ],
    indexes: [
      { name: "platform_admin_sessions_admin_id_idx", columns: ["admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_sessions_admin_id_fk", columns: ["admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_sessions_realm_check", clause: "(`realm` = _utf8mb4'PLATFORM_ADMIN')" },
      { name: "platform_admin_sessions_token_hash_check", clause: "regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$')" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_settings",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0017_platform_admin_settings_family_status.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/platformadmin",
    columns: [
      { name: "setting_key", columnType: "varchar(128)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Name/key of a Platform Admin setting." },
      { name: "category", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary settings category." },
      { name: "value_json", columnType: "text", dataType: "text", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Platform Admin internal structured JSON (audit metadata / settings value) — not schema-constrained; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "is_sensitive", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "masked_display", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent-visible billing/display label (e.g. invoice line description, masked card label) — not child/family activity content." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["setting_key"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "platform_admin_settings_category_idx", columns: ["category"], unique: false },
      { name: "platform_admin_settings_updated_by_fk", columns: ["updated_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_settings_updated_by_fk", columns: ["updated_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_settings_category_check", clause: "(`category` in (_utf8mb4'BRANDING',_utf8mb4'PAYMENT_PROVIDER',_utf8mb4'NOTIFICATION',_utf8mb4'MAINTENANCE',_utf8mb4'FEATURE_FLAG'))" },
      { name: "platform_admin_settings_key_check", clause: "(char_length(`setting_key`) between 1 and 128)" },
      { name: "platform_admin_settings_masked_display_check", clause: "(((`is_sensitive` = 1) and (`masked_display` is not null) and (char_length(`masked_display`) between 1 and 128)) or ((`is_sensitive` = 0) and (`masked_display` is null)))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "platform_admin_step_up_sessions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0005_platform_admin_identity_rbac_audit.sql",
    alteredByMigrations: ["0014_complimentary_entitlement_grants.sql"],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "step_up_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "session_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "scope", columnType: "varchar(40)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "asserted_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "consumed_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["step_up_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "platform_admin_step_up_sessions_admin_id_idx", columns: ["admin_id"], unique: false },
      { name: "platform_admin_step_up_sessions_session_id_idx", columns: ["session_id"], unique: false },
    ],
    foreignKeys: [
      { name: "platform_admin_step_up_sessions_admin_id_fk", columns: ["admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "platform_admin_step_up_sessions_session_id_fk", columns: ["session_id"], referencedTable: "platform_admin_sessions", referencedColumns: ["session_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "platform_admin_step_up_sessions_scope_check", clause: "(`scope` in (_utf8mb4'REFUND',_utf8mb4'SETTLEMENT_BANK_CONFIG',_utf8mb4'ADMIN_ROLE_GRANT',_utf8mb4'FAMILY_ACCOUNT_SUSPEND',_utf8mb4'FAMILY_ACCOUNT_REACTIVATE',_utf8mb4'ENTITLEMENT_LIMIT_OVERRIDE',_utf8mb4'COMPLIMENTARY_GRANT_MUTATION'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "protection_alerts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0025_protection_alerts.sql",
    alteredByMigrations: ["0034_audit_alert_ciphertext_expiry.sql"],
    ownerModule: "backend/src/alerts",
    columns: [
      { name: "alert_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "device_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "parent_device_id", columnType: "varchar(200)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "trigger_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "key_epoch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "generated_at_utc", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "encrypted_payload_b64", columnType: "mediumtext", dataType: "mediumtext", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque ciphertext (migration 0025): no acknowledge/decrypt/plaintext-read operation exists server-side." },
      { name: "nonce_b64", columnType: "varchar(64)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "AEAD nonce for the ciphertext column." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "1970-01-01 00:00:00.000", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["alert_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "protection_alerts_expires_at_idx", columns: ["expires_at"], unique: false },
      { name: "protection_alerts_family_idx", columns: ["family_id", "generated_at_utc"], unique: false },
      { name: "protection_alerts_parent_device_idx", columns: ["family_id", "parent_device_id", "generated_at_utc"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "protection_alerts_device_id_check", clause: "((`device_id` is null) or (char_length(`device_id`) between 1 and 200))" },
      { name: "protection_alerts_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "protection_alerts_key_epoch_check", clause: "(`key_epoch` >= 0)" },
      { name: "protection_alerts_nonce_check", clause: "(char_length(`nonce_b64`) between 1 and 64)" },
      { name: "protection_alerts_parent_device_id_check", clause: "(char_length(`parent_device_id`) between 1 and 200)" },
      { name: "protection_alerts_payload_check", clause: "(char_length(`encrypted_payload_b64`) between 1 and 4194304)" },
      { name: "protection_alerts_trigger_check", clause: "(`trigger_type` in (_utf8mb4'DISABLE_OR_REMOVAL_REQUESTED',_utf8mb4'REPEATED_INVALID_PIN',_utf8mb4'AUTHORITY_CHANGE',_utf8mb4'CRITICAL_PERMISSION_OR_VPN_LOST',_utf8mb4'UNEXPECTED_OFFLINE',_utf8mb4'TIME_TAMPERING',_utf8mb4'PROTECTION_DEGRADED',_utf8mb4'REINSTALLATION',_utf8mb4'INVITATION_REDEEMED',_utf8mb4'UNENROLLMENT'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque ciphertext + typed routing metadata (family/device/trigger/epoch), never readable family detail.", source: "backend/migrations/0025_protection_alerts.sql:1-7" },
      { column: "parent_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque ciphertext + typed routing metadata, never readable family detail.", source: "backend/migrations/0025_protection_alerts.sql:1-7" },
    ],
  },
  {
    name: "recovery_envelopes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "ciphertext", columnType: "mediumblob", dataType: "mediumblob", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque recovery envelope payload, never plaintext family/child content." },
      { name: "version", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "recovery_envelopes_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "recovery_envelopes_version_check", clause: "(`version` > 0)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "relay_envelopes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/alerts",
    columns: [
      { name: "message_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque bounded application identifier (migration 0001 TYPE DECISIONS), not message content." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "sender_device_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "recipient_device_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "ciphertext", columnType: "mediumblob", dataType: "mediumblob", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque encrypted/binary payload." },
      { name: "state", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "acknowledged_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["message_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "relay_envelopes_recipient_state_idx", columns: ["recipient_device_id", "state", "expires_at"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "relay_envelopes_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "relay_envelopes_message_id_check", clause: "(char_length(`message_id`) between 1 and 128)" },
      { name: "relay_envelopes_recipient_device_id_check", clause: "(char_length(`recipient_device_id`) between 1 and 128)" },
      { name: "relay_envelopes_sender_device_id_check", clause: "(char_length(`sender_device_id`) between 1 and 128)" },
      { name: "relay_envelopes_state_check", clause: "(`state` in (_utf8mb4'QUEUED',_utf8mb4'ACKNOWLEDGED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "sender_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque bounded application identifier by design (migration 0001 TYPE DECISIONS), distinct from devices.device_id CHAR(36) ascii_bin.", source: "backend/migrations/0001_mysql_baseline.sql:16-23" },
      { column: "recipient_device_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque bounded application identifier by design (migration 0001 TYPE DECISIONS).", source: "backend/migrations/0001_mysql_baseline.sql:16-23" },
    ],
  },
  {
    name: "release_current_pointers",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "package_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "platform", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "version", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "version_major", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "version_minor", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "version_patch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "is_explicit_rollback", columnType: "tinyint(1)", dataType: "tinyint", charset: null, collation: null, nullable: false, default: "0", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["package_type", "platform"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "release_packages",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "release_id", columnType: "varchar(256)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "package_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "platform", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "version", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "artifact_digest", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "artifact_size_bytes", columnType: "bigint unsigned", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "signing_key_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "signed_metadata", columnType: "mediumblob", dataType: "mediumblob", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque encrypted/binary payload." },
      { name: "minimum_supported_version", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "state", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "published_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "retired_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["release_id"],
    uniqueIndexes: [
      { name: "release_packages_identity_key", columns: ["package_type", "platform", "version"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "release_packages_artifact_digest_check", clause: "regexp_like(`artifact_digest`,_utf8mb4'^[0-9a-f]{64}$')" },
      { name: "release_packages_artifact_size_bytes_check", clause: "(`artifact_size_bytes` > 0)" },
      { name: "release_packages_minimum_supported_version_check", clause: "((`minimum_supported_version` is null) or regexp_like(`minimum_supported_version`,_utf8mb4'^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)$'))" },
      { name: "release_packages_package_type_check", clause: "(`package_type` in (_utf8mb4'ANDROID_APP',_utf8mb4'IOS_APP',_utf8mb4'MODEL_PACKAGE',_utf8mb4'RULE_PACKAGE'))" },
      { name: "release_packages_platform_check", clause: "(`platform` in (_utf8mb4'ANDROID',_utf8mb4'IOS',_utf8mb4'SHARED'))" },
      { name: "release_packages_release_id_check", clause: "(char_length(`release_id`) between 1 and 256)" },
      { name: "release_packages_signing_key_id_check", clause: "(char_length(`signing_key_id`) between 1 and 128)" },
      { name: "release_packages_state_check", clause: "(`state` in (_utf8mb4'PUBLISHED',_utf8mb4'RETIRED'))" },
      { name: "release_packages_version_check", clause: "regexp_like(`version`,_utf8mb4'^(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)\\\\.(0|[1-9][0-9]*)$')" },
    ],
    applicationEnforcedRelations: [
      { column: "signing_key_id", impliedReferencedTable: "device_public_keys", impliedReferencedColumn: "key_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque bounded application identifier by design; also structurally infeasible as a single-column FK since device_public_keys has a composite PK (device_id, key_id).", source: "backend/migrations/0001_mysql_baseline.sql:16-23" },
    ],
  },
  {
    name: "safe_zones",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0020_parent_preferences_safe_zones.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "zone_id", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "recipient_endpoint_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "ciphertext", columnType: "mediumblob", dataType: "mediumblob", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "ENCRYPTED_PAYLOAD", privacyNote: "Opaque encrypted payload (migration 0020): must never hold a readable label/coordinate/radius/policy." },
      { name: "nonce", columnType: "varbinary(64)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "AEAD nonce for the ciphertext column." },
      { name: "key_epoch", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "revision", columnType: "int unsigned", dataType: "int", charset: null, collation: null, nullable: false, default: "1", autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "delivery_state", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "PENDING_OFFLINE", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(6)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(6)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["zone_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "safe_zones_family_recipient_idx", columns: ["family_id", "recipient_endpoint_id"], unique: false },
    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "safe_zones_ciphertext_check", clause: "(length(`ciphertext`) between 1 and 65535)" },
      { name: "safe_zones_delivery_state_check", clause: "(`delivery_state` in (_utf8mb4'PENDING_OFFLINE',_utf8mb4'READY'))" },
      { name: "safe_zones_key_epoch_check", clause: "(`key_epoch` > 0)" },
      { name: "safe_zones_nonce_check", clause: "(length(`nonce`) between 12 and 64)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
      { column: "recipient_endpoint_id", impliedReferencedTable: "devices", impliedReferencedColumn: "device_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Opaque routing/version metadata only -- must never hold a readable label/coordinate/radius/policy; not intended as a DB-joinable identity.", source: "backend/migrations/0020_parent_preferences_safe_zones.sql:2-5" },
    ],
  },
  {
    name: "schema_migrations",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/scripts/migrate.mjs",
    columns: [
      { name: "version", columnType: "varchar(255)", dataType: "varchar", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "applied_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["version"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "security_audit_metadata",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "(none -- see PCA_CANONICAL_SCHEMA_REPORT.md orphaned-table note)",
    columns: [
      { name: "event_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "event_type", columnType: "varchar(32)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "actor_reference_hash", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "subject_reference_hash", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "correlation_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "occurred_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["event_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "security_audit_metadata_event_type_check", clause: "(`event_type` in (_utf8mb4'ACCOUNT_DISABLED',_utf8mb4'DEVICE_REVOKED',_utf8mb4'KEY_REVOKED'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "service_account_family_scopes",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/parentaccount",
    columns: [
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["account_id", "family_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "service_account_family_scopes_family_id_idx", columns: ["family_id"], unique: false },
    ],
    foreignKeys: [
      { name: "service_account_family_scopes_account_id_fk", columns: ["account_id"], referencedTable: "service_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "service_account_family_scopes_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "service_account_family_scopes_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'REVOKED'))" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
  {
    name: "service_accounts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/auth",
    columns: [
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_reference_hash", columnType: "varbinary(255)", dataType: "varbinary", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "disabled_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["account_id"],
    uniqueIndexes: [
      { name: "service_accounts_account_reference_hash_key", columns: ["account_reference_hash"], unique: true },
    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [

    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "service_sessions",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0001_mysql_baseline.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/parentaccount",
    columns: [
      { name: "session_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "token_hash", columnType: "char(64)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "SECURITY_METADATA", privacyNote: "Authentication/verification/integrity hash material, never a raw secret or raw identifying value." },
      { name: "issued_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expires_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "revoked_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["session_id"],
    uniqueIndexes: [
      { name: "service_sessions_token_hash_key", columns: ["token_hash"], unique: true },
    ],
    indexes: [
      { name: "service_sessions_account_id_idx", columns: ["account_id"], unique: false },
    ],
    foreignKeys: [
      { name: "service_sessions_account_id_fk", columns: ["account_id"], referencedTable: "service_accounts", referencedColumns: ["account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "service_sessions_token_hash_check", clause: "regexp_like(`token_hash`,_utf8mb4'^[0-9a-f]{64}$')" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "settlement_accounts",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0015_settlement_reconciliation.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "settlement_account_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "provider_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "display_label", columnType: "varchar(64)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "READABLE_PARENT_DATA", privacyNote: "Parent-visible billing/display label (e.g. invoice line description, masked card label) — not child/family activity content." },
      { name: "settlement_currency", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "status", columnType: "varchar(16)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: "ACTIVE", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["settlement_account_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "settlement_accounts_currency_fk", columns: ["settlement_currency"], unique: false },
      { name: "settlement_accounts_status_idx", columns: ["status"], unique: false },
    ],
    foreignKeys: [
      { name: "settlement_accounts_currency_fk", columns: ["settlement_currency"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "settlement_accounts_display_label_check", clause: "(char_length(`display_label`) between 1 and 64)" },
      { name: "settlement_accounts_provider_ref_check", clause: "(char_length(`provider_ref`) between 1 and 128)" },
      { name: "settlement_accounts_status_check", clause: "(`status` in (_utf8mb4'ACTIVE',_utf8mb4'INACTIVE'))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "settlement_batch_items",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0015_settlement_reconciliation.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "settlement_batch_item_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "settlement_batch_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "payment_transaction_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "amount_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "currency_code", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["settlement_batch_item_id"],
    uniqueIndexes: [
      { name: "settlement_batch_items_transaction_key", columns: ["payment_transaction_id"], unique: true },
    ],
    indexes: [
      { name: "settlement_batch_items_batch_idx", columns: ["settlement_batch_id"], unique: false },
      { name: "settlement_batch_items_currency_fk", columns: ["currency_code"], unique: false },
    ],
    foreignKeys: [
      { name: "settlement_batch_items_batch_fk", columns: ["settlement_batch_id"], referencedTable: "settlement_batches", referencedColumns: ["settlement_batch_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batch_items_currency_fk", columns: ["currency_code"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batch_items_transaction_fk", columns: ["payment_transaction_id"], referencedTable: "billing_payment_transactions", referencedColumns: ["payment_transaction_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "settlement_batch_items_amount_check", clause: "(`amount_minor` >= 0)" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "settlement_batches",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0015_settlement_reconciliation.sql",
    alteredByMigrations: ["0018_settlement_usd_normalization.sql"],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "settlement_batch_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "settlement_account_ref", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "settlement_currency", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "period_start", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "period_end", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "expected_gross_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "fees_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "net_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "received_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "difference_minor", columnType: "bigint", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "status", columnType: "varchar(24)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "provider_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "resolution_reason", columnType: "varchar(500)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Admin-authored free-text business-process justification (always paired with a *_by_admin_id column) — never child/family personal content, but genuinely free-text; see PCA_CANONICAL_SCHEMA_REPORT.md caveat." },
      { name: "resolved_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "resolved_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "created_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: true, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "usd_normalized_rate", columnType: "decimal(24,10)", dataType: "decimal", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "usd_normalized_recorded_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "usd_normalized_by_admin_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: true, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
    ],
    primaryKey: ["settlement_batch_id"],
    uniqueIndexes: [

    ],
    indexes: [
      { name: "settlement_batches_account_ref_idx", columns: ["settlement_account_ref"], unique: false },
      { name: "settlement_batches_created_by_fk", columns: ["created_by_admin_id"], unique: false },
      { name: "settlement_batches_currency_fk", columns: ["settlement_currency"], unique: false },
      { name: "settlement_batches_period_idx", columns: ["period_start", "period_end"], unique: false },
      { name: "settlement_batches_resolved_by_fk", columns: ["resolved_by_admin_id"], unique: false },
      { name: "settlement_batches_status_idx", columns: ["status"], unique: false },
      { name: "settlement_batches_usd_norm_by_fk", columns: ["usd_normalized_by_admin_id"], unique: false },
    ],
    foreignKeys: [
      { name: "settlement_batches_account_fk", columns: ["settlement_account_ref"], referencedTable: "settlement_accounts", referencedColumns: ["settlement_account_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batches_created_by_fk", columns: ["created_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batches_currency_fk", columns: ["settlement_currency"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batches_resolved_by_fk", columns: ["resolved_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_batches_usd_norm_by_fk", columns: ["usd_normalized_by_admin_id"], referencedTable: "platform_admin_accounts", referencedColumns: ["admin_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "settlement_batches_amounts_nonneg_check", clause: "((`expected_gross_minor` >= 0) and (`fees_minor` >= 0) and (`net_minor` >= 0) and (`received_minor` >= 0))" },
      { name: "settlement_batches_difference_check", clause: "(`difference_minor` = (`received_minor` - `net_minor`))" },
      { name: "settlement_batches_period_check", clause: "(`period_end` > `period_start`)" },
      { name: "settlement_batches_provider_ref_check", clause: "(char_length(`provider_ref`) between 1 and 128)" },
      { name: "settlement_batches_resolution_pair_check", clause: "(((`status` = _utf8mb4'RESOLVED') and (`resolution_reason` is not null) and (`resolved_by_admin_id` is not null) and (`resolved_at` is not null)) or ((`status` <> _utf8mb4'RESOLVED') and (`resolution_reason` is null) and (`resolved_by_admin_id` is null) and (`resolved_at` is null)))" },
      { name: "settlement_batches_status_check", clause: "(`status` in (_utf8mb4'MATCHED',_utf8mb4'UNDER_INVESTIGATION',_utf8mb4'RESOLVED'))" },
      { name: "settlement_batches_usd_norm_pair_check", clause: "(((`usd_normalized_rate` is null) and (`usd_normalized_recorded_at` is null) and (`usd_normalized_by_admin_id` is null)) or ((`usd_normalized_rate` is not null) and (`usd_normalized_recorded_at` is not null) and (`usd_normalized_by_admin_id` is not null)))" },
      { name: "settlement_batches_usd_norm_rate_check", clause: "((`usd_normalized_rate` is null) or (`usd_normalized_rate` > 0))" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "settlement_fx_snapshots",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0015_settlement_reconciliation.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/billing",
    columns: [
      { name: "settlement_fx_snapshot_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "settlement_batch_item_id", columnType: "char(36)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "source_currency", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "settlement_currency", columnType: "char(3)", dataType: "char", charset: "ascii", collation: "ascii_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Closed-vocabulary status/type/category/currency/market column." },
      { name: "recorded_rate", columnType: "decimal(24,10)", dataType: "decimal", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "effective_timestamp", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
      { name: "provider_ref", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "created_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: "CURRENT_TIMESTAMP(3)", autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["settlement_fx_snapshot_id"],
    uniqueIndexes: [
      { name: "settlement_fx_snapshots_item_key", columns: ["settlement_batch_item_id"], unique: true },
    ],
    indexes: [
      { name: "settlement_fx_snapshots_settlement_currency_fk", columns: ["settlement_currency"], unique: false },
      { name: "settlement_fx_snapshots_source_currency_fk", columns: ["source_currency"], unique: false },
    ],
    foreignKeys: [
      { name: "settlement_fx_snapshots_item_fk", columns: ["settlement_batch_item_id"], referencedTable: "settlement_batch_items", referencedColumns: ["settlement_batch_item_id"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_fx_snapshots_settlement_currency_fk", columns: ["settlement_currency"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
      { name: "settlement_fx_snapshots_source_currency_fk", columns: ["source_currency"], referencedTable: "billing_currencies", referencedColumns: ["currency_code"], onDelete: "NO ACTION", onUpdate: "NO ACTION" },
    ],
    checkConstraints: [
      { name: "settlement_fx_snapshots_currency_pair_check", clause: "(`source_currency` <> `settlement_currency`)" },
      { name: "settlement_fx_snapshots_provider_ref_check", clause: "(char_length(`provider_ref`) between 1 and 128)" },
      { name: "settlement_fx_snapshots_rate_check", clause: "(`recorded_rate` > 0)" },
    ],
    applicationEnforcedRelations: [

    ],
  },
  {
    name: "sync_sequence_progress_ledger",
    engine: 'InnoDB',
    charset: "utf8mb4",
    collation: "utf8mb4_bin",
    createdByMigration: "0002_sync_durability.sql",
    alteredByMigrations: [],
    ownerModule: "backend/src/db",
    columns: [
      { name: "family_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "sender_key_id", columnType: "varchar(128)", dataType: "varchar", charset: "utf8mb4", collation: "utf8mb4_bin", nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPAQUE_IDENTIFIER", privacyNote: "Opaque application identifier (see PCA_RELATIONSHIP_ENFORCEMENT_MATRIX.md for FK/soft-reference classification)." },
      { name: "last_applied_sequence", columnType: "bigint unsigned", dataType: "bigint", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: true, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Numeric/boolean operational counter, limit, flag, rate, or version." },
      { name: "updated_at", columnType: "datetime(3)", dataType: "datetime", charset: null, collation: null, nullable: false, default: null, autoIncrement: false, unsigned: false, onUpdateCurrentTimestamp: false, generatedExpression: null, generatedStorage: null, privacy: "OPERATIONAL_METADATA", privacyNote: "Timestamp." },
    ],
    primaryKey: ["family_id", "sender_key_id"],
    uniqueIndexes: [

    ],
    indexes: [

    ],
    foreignKeys: [

    ],
    checkConstraints: [
      { name: "sync_sequence_progress_ledger_family_id_check", clause: "(char_length(`family_id`) between 1 and 128)" },
      { name: "sync_sequence_progress_ledger_sender_key_id_check", clause: "(char_length(`sender_key_id`) between 1 and 128)" },
    ],
    applicationEnforcedRelations: [
      { column: "family_id", impliedReferencedTable: "families", impliedReferencedColumn: "family_id", status: 'APPLICATION_ENFORCED_INTENTIONAL', rationale: "Soft (unenforced) family_id reference -- schema-wide convention. families.family_id is CHAR(36) ascii_bin; every other table's family_id is VARCHAR(128) utf8mb4_bin. Membership existence is checked at the application layer (AuthzService.requiresFamilyScope).", source: "backend/migrations/0036_family_child_memberships.sql:44-54; backend/migrations/0027_family_member_invitations.sql:17-25; backend/migrations/0013_parent_account_identity.sql" },
    ],
  },
];
