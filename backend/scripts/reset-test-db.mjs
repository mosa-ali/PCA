// Destructively resets ONLY the dedicated pca_test database: drops it and
// recreates it EMPTY (no migrations applied). PCA_DATABASE_URL's path
// component (the database name) is hard-checked against an allowlist
// before any DROP DATABASE runs -- this script must never be able to drop
// an unknown/production database, even if misconfigured. Run `npm run
// db:migrate` (or `npm run test:db`, which applies migrations itself via
// scripts/verify-mysql.mjs) afterward to bring the schema back up.
import mysql from 'mysql2/promise';

const ALLOWED_TEST_DATABASES = new Set(['pca_test']);

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required to reset the test database.');

const url = new URL(connectionString);
const databaseName = url.pathname.replace(/^\//, '');
if (!ALLOWED_TEST_DATABASES.has(databaseName)) {
  throw new Error(
    `Refusing to reset database "${databaseName}": db:reset:test only ever operates on ${[...ALLOWED_TEST_DATABASES].join(', ')}.`,
  );
}

const adminUrl = new URL(connectionString);
adminUrl.pathname = '/';
const admin = await mysql.createConnection({ uri: adminUrl.toString(), timezone: 'Z' });
try {
  await admin.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  await admin.query(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);
  console.log(`Recreated database "${databaseName}" (empty).`);
} finally {
  await admin.end();
}
