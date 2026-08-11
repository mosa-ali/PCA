-- Owner-run bootstrap for local MySQL 8.4 development/test databases.
-- Run this manually as an admin user (e.g. `mysql -u root -p < bootstrap-local.sql`)
-- -- it is NOT executed automatically by any script, and no password here
-- is real; replace CHANGE_ME_DEV / CHANGE_ME_TEST before running, then set
-- the matching PCA_DB_PASSWORD / PCA_DATABASE_URL values in your local .env.
--
-- Creates the two dedicated local databases and their least-privilege
-- application users. Never touches any other database.

CREATE DATABASE IF NOT EXISTS pca_dev CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;
CREATE DATABASE IF NOT EXISTS pca_test CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE USER IF NOT EXISTS 'pca_dev_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_DEV';
CREATE USER IF NOT EXISTS 'pca_test_app'@'127.0.0.1' IDENTIFIED BY 'CHANGE_ME_TEST';

-- Least privilege: DML + the DDL needed to run migrations against ONLY the
-- matching dedicated database, nothing else on the server.
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON pca_dev.* TO 'pca_dev_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES
  ON pca_test.* TO 'pca_test_app'@'127.0.0.1';

FLUSH PRIVILEGES;
