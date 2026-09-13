/**
 * TEMPORARY SESSION-1 PATH C diagnostic.
 *
 * This route is intentionally platform-admin authenticated, fixed-query only,
 * read-only, and returns no connection material. It must be removed after the
 * owner captures the evidence; it is not a product API.
 */
import { createHash } from 'node:crypto';
import { promises as dns } from 'node:dns';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { PoolConnection } from 'mysql2/promise';
import { getPool } from '../../../db/pool.js';
import { authorizePlatformAdminOperation } from '../../../platformadmin/auth/rbacPolicy.js';
import type { PlatformAdminAuthService } from '../../../platformadmin/auth/PlatformAdminAuthService.js';
import { createRequirePlatformAdminSession } from '../../../platformadmin/auth/fastifyPlatformAdminAuthPlugin.js';
import type { createRateLimiter } from '../../rateLimit.js';

const EXPECTED_FINGERPRINT = '278c141ea752ea9a1867693810d2e5380b5c1ca4568b12d4c8952ba4f680329f';
const AUDIT_TABLE = 'platform_admin_audit_events';
const MIGRATION_TABLE = 'schema_migrations';
const REQUIRED_PRIVILEGES = new Map([
  [AUDIT_TABLE, ['SELECT', 'INSERT']],
  [MIGRATION_TABLE, ['SELECT']],
]);
const ORDINARY_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];
const PROHIBITED_PRIVILEGES = new Set(['CREATE', 'DROP', 'ALTER', 'GRANT OPTION', 'FILE', 'SUPER', 'CREATE USER']);

type DbRow = Record<string, any>;
type Introspection = { database: string; tables: Record<string, any> };

async function rows(conn: PoolConnection, sql: string, params: readonly unknown[] = []): Promise<DbRow[]> {
  const [result] = await conn.query(sql, params as unknown[]);
  return (Array.isArray(result) ? result : []) as DbRow[];
}

function ident(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``;
}

function findMatchingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('invalid DDL');
}

function extractChecks(ddl: string): Array<{ name: string; clause: string }> {
  const result: Array<{ name: string; clause: string }> = [];
  const re = /CONSTRAINT `([^`]+)` CHECK \(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ddl))) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingParen(ddl, open);
    result.push({ name: match[1], clause: ddl.slice(open + 1, close) });
  }
  return result;
}

function extractGenerated(ddl: string): Map<string, { expression: string; storage: string }> {
  const result = new Map<string, { expression: string; storage: string }>();
  const re = /^ {2}`([^`]+)`[^\n]*? GENERATED ALWAYS AS \(/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(ddl))) {
    const open = match.index + match[0].length - 1;
    const close = findMatchingParen(ddl, open);
    const after = ddl.slice(close + 1, close + 20);
    result.set(match[1], { expression: ddl.slice(open + 1, close), storage: /^\s*VIRTUAL/.test(after) ? 'VIRTUAL' : 'STORED' });
  }
  return result;
}

async function introspect(conn: PoolConnection, database: string): Promise<Introspection> {
  const tableRows = await rows(
    conn,
    `SELECT table_name, engine, table_collation, create_options, table_comment
       FROM information_schema.tables
      WHERE table_schema = ? AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
    [database],
  );
  const tables: Record<string, any> = {};
  for (const t of tableRows) {
    const table = String(t.table_name ?? t.TABLE_NAME);
    const tableCollation = t.table_collation ?? t.TABLE_COLLATION;
    const charsetRows = await rows(
      conn,
      `SELECT ccsa.character_set_name AS charset
         FROM information_schema.collations c
         JOIN information_schema.character_sets ccsa ON c.character_set_name = ccsa.character_set_name
        WHERE c.collation_name = ?`,
      [tableCollation],
    );
    const columns = await rows(
      conn,
      `SELECT column_name, ordinal_position, column_type, data_type, character_maximum_length,
              numeric_precision, numeric_scale, is_nullable, column_default, extra,
              character_set_name, collation_name, (column_type LIKE '%unsigned%') AS is_unsigned
         FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position`,
      [database, table],
    );
    const stats = await rows(
      conn,
      `SELECT index_name, non_unique, seq_in_index, column_name
         FROM information_schema.statistics WHERE table_schema = ? AND table_name = ?
        ORDER BY index_name, seq_in_index`,
      [database, table],
    );
    const indexMap = new Map<string, { name: string; unique: boolean; columns: string[] }>();
    for (const s of stats) {
      const name = String(s.index_name ?? s.INDEX_NAME);
      if (!indexMap.has(name)) indexMap.set(name, { name, unique: Number(s.non_unique ?? s.NON_UNIQUE) === 0, columns: [] });
      indexMap.get(name)!.columns.push(String(s.column_name ?? s.COLUMN_NAME));
    }
    const indexes = [...indexMap.values()];
    const primaryKey = indexMap.get('PRIMARY')?.columns ?? [];
    const fkRows = await rows(
      conn,
      `SELECT k.constraint_name, k.column_name, k.referenced_table_name, k.referenced_column_name,
              k.ordinal_position, r.update_rule, r.delete_rule
         FROM information_schema.key_column_usage k
         JOIN information_schema.referential_constraints r
           ON r.constraint_schema = k.constraint_schema AND r.constraint_name = k.constraint_name
        WHERE k.table_schema = ? AND k.table_name = ? AND k.referenced_table_name IS NOT NULL
        ORDER BY k.constraint_name, k.ordinal_position`,
      [database, table],
    );
    const fkMap = new Map<string, any>();
    for (const fk of fkRows) {
      const name = String(fk.constraint_name ?? fk.CONSTRAINT_NAME);
      if (!fkMap.has(name)) {
        fkMap.set(name, {
          name,
          columns: [],
          referencedTable: String(fk.referenced_table_name ?? fk.REFERENCED_TABLE_NAME),
          referencedColumns: [],
          onUpdate: fk.update_rule ?? fk.UPDATE_RULE,
          onDelete: fk.delete_rule ?? fk.DELETE_RULE,
        });
      }
      const item = fkMap.get(name)!;
      item.columns.push(String(fk.column_name ?? fk.COLUMN_NAME));
      item.referencedColumns.push(String(fk.referenced_column_name ?? fk.REFERENCED_COLUMN_NAME));
    }
    const [[createRow]] = await conn.query(`SHOW CREATE TABLE ${ident(table)}`) as [DbRow[], unknown];
    const ddl = String(createRow['Create Table'] ?? createRow['CREATE TABLE'] ?? '');
    const generated = extractGenerated(ddl);
    tables[table] = {
      engine: t.engine ?? t.ENGINE,
      charset: charsetRows[0]?.charset ?? null,
      collation: tableCollation,
      columns: columns.map((c) => {
        const name = String(c.column_name ?? c.COLUMN_NAME);
        return {
          name,
          columnType: c.column_type ?? c.COLUMN_TYPE,
          nullable: (c.is_nullable ?? c.IS_NULLABLE) === 'YES',
          default: c.column_default ?? c.COLUMN_DEFAULT,
          extra: c.extra ?? c.EXTRA,
          charset: c.character_set_name ?? c.CHARACTER_SET_NAME,
          collation: c.collation_name ?? c.COLLATION_NAME,
          unsigned: Boolean(c.is_unsigned ?? c.IS_UNSIGNED),
          generatedExpression: generated.get(name)?.expression ?? null,
          generatedStorage: generated.get(name)?.storage ?? null,
        };
      }),
      primaryKey,
      indexes,
      foreignKeys: [...fkMap.values()],
      checkConstraints: extractChecks(ddl),
    };
  }
  return { database, tables };
}

function fingerprint(introspection: Introspection): string {
  const normalized = Object.keys(introspection.tables).sort().map((name) => {
    const table = introspection.tables[name];
    return {
      name,
      engine: table.engine,
      charset: table.charset,
      collation: table.collation,
      columns: table.columns.map((c: DbRow) => ({
        name: c.name,
        columnType: c.columnType,
        nullable: c.nullable,
        default: c.default,
        extra: c.extra,
        charset: c.charset,
        collation: c.collation,
        unsigned: c.unsigned,
        generatedExpression: c.generatedExpression,
        generatedStorage: c.generatedStorage,
      })),
      primaryKey: [...table.primaryKey],
      indexes: [...table.indexes].map((i: DbRow) => ({ name: i.name, unique: i.unique, columns: [...i.columns] })).sort((a, b) => a.name.localeCompare(b.name)),
      foreignKeys: [...table.foreignKeys]
        .map((fk: DbRow) => ({ columns: [...fk.columns], referencedTable: fk.referencedTable, referencedColumns: [...fk.referencedColumns], onDelete: fk.onDelete, onUpdate: fk.onUpdate }))
        .sort((a, b) => a.columns.join(',').localeCompare(b.columns.join(','))),
      checkConstraints: [...table.checkConstraints].map((c: DbRow) => c.clause).sort(),
    };
  });
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function isPrivateAddress(address: string): boolean {
  if (/^(10\.|127\.|192\.168\.)/.test(address)) return true;
  const match = address.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  return /^(fc|fd)[0-9a-f]{2}:/i.test(address);
}

function parseGrant(grant: string): { scope: string; privileges: string[]; prohibited: string[] } {
  const match = grant.match(/^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/i);
  if (!match) return { scope: 'UNPARSED', privileges: [], prohibited: [] };
  const privileges = match[1].split(',').map((value) => value.trim().toUpperCase()).filter(Boolean);
  return { scope: match[2].replace(/`/g, ''), privileges, prohibited: privileges.filter((value) => PROHIBITED_PRIVILEGES.has(value)) };
}

function evaluateLeastPrivilege(grantRows: DbRow[], database: string): DbRow {
  const parsed = grantRows.map((row) => parseGrant(String(Object.values(row)[0] ?? '')));
  const prohibited = parsed.flatMap((grant) => grant.prohibited);
  const scopes = parsed.map((grant) => grant.scope);
  const hasGlobal = scopes.some((scope) => scope === '*.*' || scope === '*');
  const required = [...REQUIRED_PRIVILEGES.entries()].every(([table, privileges]) => {
    const grant = parsed.find((item) => item.scope.toLowerCase() === `${database}.${table}`.toLowerCase());
    return grant && privileges.every((privilege) => grant.privileges.includes(privilege));
  });
  const ordinary = parsed.some((grant) => grant.scope.toLowerCase() === `${database}.*`.toLowerCase() && ORDINARY_PRIVILEGES.every((privilege) => grant.privileges.includes(privilege))) ||
    parsed.some((grant) => grant.scope.toLowerCase() === `${database}.*`.toLowerCase());
  return {
    status: prohibited.length === 0 && !hasGlobal && required && ordinary ? 'PASS' : 'FAIL',
    scopes,
    prohibited: [...new Set(prohibited)],
    requiredTables: { [AUDIT_TABLE]: REQUIRED_PRIVILEGES.get(AUDIT_TABLE), [MIGRATION_TABLE]: REQUIRED_PRIVILEGES.get(MIGRATION_TABLE), ordinary: ORDINARY_PRIVILEGES },
  };
}

export interface DbRuntimeDiagnosticRoutesDeps {
  platformAdminAuthService: PlatformAdminAuthService;
  rateLimiter: ReturnType<typeof createRateLimiter>;
}

export function registerDbRuntimeDiagnosticRoutes(app: FastifyInstance, deps: DbRuntimeDiagnosticRoutesDeps): void {
  const requireSession = createRequirePlatformAdminSession(deps.platformAdminAuthService);
  const limiter = deps.rateLimiter({ windowMs: 60_000, max: 2, bucket: 'temporary-db-runtime-diagnostic' });

  app.get('/platform-admin/internal/db-runtime-diagnostic', { preHandler: [limiter, requireSession] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const roles = request.platformAdminRoles ?? [];
    if (authorizePlatformAdminOperation(roles, 'ADMINISTER_NONSENSITIVE_PLATFORM_SETTINGS') !== 'ALLOW') {
      return reply.code(403).send({ error: 'forbidden' });
    }
    try {
      const uri = process.env.PCA_DATABASE_URL;
      if (!uri) return reply.code(503).send({ error: 'diagnostic_unavailable' });
      const parsedUri = new URL(uri);
      const hostname = parsedUri.hostname;
      const addresses = await dns.lookup(hostname, { all: true });
      const address = addresses[0]?.address ?? '';
      const conn = await getPool().getConnection();
      try {
        const [identity] = await conn.query('SELECT CURRENT_USER() AS account, DATABASE() AS database_name');
        const identityRow = (Array.isArray(identity) ? identity[0] : {}) as DbRow;
        const tlsRows = await rows(conn, `SHOW SESSION STATUS WHERE Variable_name IN ('Ssl_version', 'Ssl_cipher')`);
        const tls = new Map(tlsRows.map((row) => [String(row.Variable_name ?? row.VARIABLE_NAME), String(row.Value ?? row.VALUE ?? '')]));
        const [counts] = await conn.query(
          `SELECT
             (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE') AS tables_count,
             (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE()) AS columns_count,
             (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_type = 'PRIMARY KEY') AS pks_count,
             (SELECT COUNT(DISTINCT CONCAT(table_name, '.', constraint_name)) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND constraint_type = 'FOREIGN KEY') AS fks_count,
             (SELECT COUNT(DISTINCT CONCAT(table_name, '.', index_name)) FROM information_schema.statistics WHERE table_schema = DATABASE() AND non_unique = 0 AND index_name <> 'PRIMARY') AS non_pk_unique_count,
             (SELECT COUNT(DISTINCT CONCAT(table_name, '.', index_name)) FROM information_schema.statistics WHERE table_schema = DATABASE() AND non_unique = 1) AS nonunique_indexes_count,
             (SELECT COUNT(*) FROM information_schema.check_constraints WHERE constraint_schema = DATABASE()) AS checks_count`,
        );
        const countRow = (Array.isArray(counts) ? counts[0] : {}) as DbRow;
        const database = String(identityRow.database_name ?? '');
        const schema = await introspect(conn, database);
        const migrationRows = await rows(conn, `SELECT version, applied_at FROM schema_migrations ORDER BY applied_at DESC, version DESC`);
        const latest = migrationRows[0]?.version ? String(migrationRows[0].version) : null;
        const migration0022 = migrationRows.some((row) => String(row.version ?? '').startsWith('0022_')) ? 'APPLIED' : 'NOT_APPLIED';
        const grantRows = await rows(conn, 'SHOW GRANTS FOR CURRENT_USER()');
        return reply.code(200).send({
          DB_RUNTIME_ACCOUNT: String(identityRow.account ?? ''),
          DB_ACTIVE_DATABASE: database,
          DB_TLS_VERSION: tls.get('Ssl_version') ?? '',
          DB_TLS_CIPHER: tls.get('Ssl_cipher') ?? '',
          DB_HOSTNAME: hostname,
          DB_RESOLVED_ADDRESS: address,
          DB_NETWORK_CLASSIFICATION: isPrivateAddress(address) ? 'PRIVATE' : 'NON_PRIVATE',
          DB_SCHEMA_COUNTS: {
            TABLES: Number(countRow.tables_count), COLUMNS: Number(countRow.columns_count), PKS: Number(countRow.pks_count),
            FKS: Number(countRow.fks_count), NON_PK_UNIQUE: Number(countRow.non_pk_unique_count), NONUNIQUE_INDEXES: Number(countRow.nonunique_indexes_count), CHECKS: Number(countRow.checks_count),
          },
          DB_SCHEMA_FINGERPRINT: `sha256:${fingerprint(schema)}`,
          DB_MIGRATION_COUNT: migrationRows.length,
          DB_LATEST_MIGRATION: latest,
          MIGRATION_0022_STATUS: migration0022,
          DB_LEAST_PRIVILEGE: evaluateLeastPrivilege(grantRows, database),
          EXPECTED_FINGERPRINT_MATCH: fingerprint(schema) === EXPECTED_FINGERPRINT,
        });
      } finally {
        conn.release();
      }
    } catch {
      // Never serialize the underlying error: mysql2 errors can contain URI
      // fragments or server details. The caller receives only a safe status.
      return reply.code(503).send({ error: 'diagnostic_unavailable' });
    }
  });
}
