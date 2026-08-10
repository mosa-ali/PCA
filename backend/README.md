# PCA backend foundation

This is the PCA-1 backend foundation: Node.js 22 LTS, TypeScript, Fastify, PostgreSQL migrations, and a disposable Docker Compose database. It deliberately contains no readable family-activity persistence, invitation lifecycle implementation, policy payload storage, cryptographic suite, or recovery workflow.

The central-service privacy boundary is enforced by migration inspection tests. Schema fields are opaque identifiers, public material, encrypted envelopes, bounded operational metadata, or security audit metadata only. New migrations require corresponding privacy tests before they may be accepted.

Local deterministic gates:

```powershell
cd backend
npm ci
npm run build
npm test
```

With a usable Docker daemon, run the disposable database gate:

```powershell
docker compose up -d --wait
$env:PCA_DATABASE_URL = 'postgresql://pca_test:pca_test_only_not_a_secret@127.0.0.1:55432/pca_test'
npm run test:db
docker compose down --volumes
```

`test:db` only accepts a loopback or Compose service PostgreSQL URL, applies each SQL migration transactionally, and asserts the privacy allowlist. It never uses a developer or production database.
