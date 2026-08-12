/**
 * Bounded reconnect-batch/backoff/session ceilings for PCA-16 offline-first
 * runtime sync. Mirrors contracts/runtime-sync/catalogue.json -- keep the
 * two in sync (contracts/runtime-sync/test asserts the catalogue's own
 * shape, not these constants directly, since the catalogue is
 * representation-neutral and this file is the TypeScript-runtime one).
 */

// No single reconnect delivery attempt ever submits more than this many
// envelopes -- an unbounded drain would let a single flapping reconnect
// starve every other family's fair share of relay/DB work.
export const MAX_OUTBOUND_BATCH_SIZE = 25;

// Independent, tighter ceiling than relay's own MAX_RELAY_TTL_MS -- this
// bounds how many times a client-side caller is expected to retry a single
// item before giving up and reporting it explicitly failed/expired, not how
// long the relay itself queues it.
export const MAX_RETRY_COUNT = 8;

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_CAP_MS = 300_000; // 5 minutes

// Device session TTL: short-lived on purpose -- a device is expected to
// re-authenticate (cheap: DSK-signed challenge/response) periodically
// rather than hold one long-lived bearer token indefinitely.
export const DEVICE_SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

export const MAX_INBOUND_LIST_SIZE = 100;
