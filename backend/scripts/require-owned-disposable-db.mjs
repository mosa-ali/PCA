import { URL } from 'node:url';

const connectionString = process.env.PCA_DATABASE_URL;
if (!connectionString) throw new Error('PCA_DATABASE_URL is required for the disposable DB inner test lane.');
const url = new URL(connectionString);
const database = decodeURIComponent(url.pathname.slice(1));
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
const compose = url.hostname === 'mysql';
if (process.env.PCA_DISPOSABLE_TEST_DATABASE_OWNER !== 'with-disposable-db'
  || !(loopback || compose)
  || !/^pca_test_codex_[a-f0-9]{32}$/.test(database)) {
  throw new Error('DB inner suites may run only against a verifier-owned, randomly named local/Compose disposable database.');
}
