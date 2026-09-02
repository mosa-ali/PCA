// PCA-RUNTIME-SHUTDOWN-1 regression tests.
//
// The defect these lock down: SIGTERM/SIGINT handlers that only cleared an
// interval timer. Attaching any listener replaces Node's default terminate
// disposition, so SIGTERM stopped terminating the process at all -- the
// orchestrator waited out its grace period and SIGKILLed mid-request /
// mid-transaction on every deploy, and closePool() had no caller in src/.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  CONSOLE_SHUTDOWN_LOGGER,
  DEFAULT_SHUTDOWN_SIGNALS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  createGracefulShutdownHandler,
  registerGracefulShutdown,
} from '../../dist/runtime/gracefulShutdown.js';

function recorder() {
  const events = [];
  return {
    events,
    log: {
      info: (event, detail) => events.push({ level: 'info', event, detail }),
      warn: (event, detail) => events.push({ level: 'warn', event, detail }),
    },
  };
}

function harness(overrides = {}) {
  const calls = [];
  const exits = [];
  const { events, log } = recorder();
  const options = {
    stopBackgroundWork: () => calls.push('stopBackgroundWork'),
    closeServer: async () => {
      calls.push('closeServer');
    },
    closeDatabasePool: async () => {
      calls.push('closeDatabasePool');
    },
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 1_000,
    ...overrides,
  };
  return { calls, exits, events, handler: createGracefulShutdownHandler(options) };
}

test('SIGTERM actually terminates: background work stops, the server drains, the pool closes, then the process exits 0', async () => {
  const { calls, exits, handler } = harness();

  await handler('SIGTERM');

  // Order matters: the pool must be released only AFTER in-flight requests
  // have drained, or the last request loses its connection mid-transaction.
  assert.deepEqual(calls, ['stopBackgroundWork', 'closeServer', 'closeDatabasePool']);
  assert.deepEqual(exits, [0], 'the process must be exited -- the old handler never exited at all');
});

test('SIGINT is handled on the same path as SIGTERM', async () => {
  const { calls, exits, handler } = harness();

  await handler('SIGINT');

  assert.deepEqual(calls, ['stopBackgroundWork', 'closeServer', 'closeDatabasePool']);
  assert.deepEqual(exits, [0]);
});

test('a second signal during an in-flight shutdown does not re-run the sequence', async () => {
  let releaseServerClose;
  const serverClosed = new Promise((resolve) => {
    releaseServerClose = resolve;
  });
  const calls = [];
  const exits = [];
  const { events, log } = recorder();
  const handler = createGracefulShutdownHandler({
    stopBackgroundWork: () => calls.push('stopBackgroundWork'),
    closeServer: async () => {
      calls.push('closeServer');
      await serverClosed;
    },
    closeDatabasePool: async () => {
      calls.push('closeDatabasePool');
    },
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 5_000,
  });

  const first = handler('SIGTERM');
  const second = handler('SIGTERM');
  const third = handler('SIGINT');
  assert.equal(second, first, 'a repeat signal folds onto the in-flight run');
  assert.equal(third, first);

  releaseServerClose();
  await Promise.all([first, second, third]);

  // Double-closing the pool or the server is exactly what re-entrancy would
  // cause, so each step must appear exactly once.
  assert.deepEqual(calls, ['stopBackgroundWork', 'closeServer', 'closeDatabasePool']);
  assert.deepEqual(exits, [0], 'exit must be called once, not once per signal');
  assert.equal(
    events.filter((entry) => entry.event === 'shutdown.signal_ignored_already_shutting_down').length,
    2,
  );
});

test('a stalled close is bounded: the process still exits, non-zero, without waiting forever', async () => {
  const exits = [];
  const { events, log } = recorder();
  const handler = createGracefulShutdownHandler({
    stopBackgroundWork: () => {},
    // Never settles -- a wedged connection or a request that never finishes.
    closeServer: () => new Promise(() => {}),
    closeDatabasePool: async () => {},
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 20,
  });

  await handler('SIGTERM');

  assert.deepEqual(exits, [1], 'a timed-out drain must still terminate, and report failure');
  assert.ok(events.some((entry) => entry.event === 'shutdown.timed_out'));
});

test('a failing server close still releases the pool and reports a non-zero exit', async () => {
  const calls = [];
  const exits = [];
  const { events, log } = recorder();
  const handler = createGracefulShutdownHandler({
    stopBackgroundWork: () => calls.push('stopBackgroundWork'),
    closeServer: async () => {
      throw new Error('close boom');
    },
    closeDatabasePool: async () => calls.push('closeDatabasePool'),
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 1_000,
  });

  await handler('SIGTERM');

  assert.deepEqual(calls, ['stopBackgroundWork', 'closeDatabasePool'], 'the pool is released even when the server close fails');
  assert.deepEqual(exits, [1]);
  const failure = events.find((entry) => entry.event === 'shutdown.server_close_failed');
  assert.ok(failure);
  // Only `error.message` is ever logged: mysql2 hangs the fully-bound SQL
  // off the error object, so logging the object itself would leak real rows.
  assert.deepEqual(failure.detail, { error: 'close boom' });
});

test('a failing pool close is reported and still exits non-zero', async () => {
  const exits = [];
  const { events, log } = recorder();
  const handler = createGracefulShutdownHandler({
    stopBackgroundWork: () => {},
    closeServer: async () => {},
    closeDatabasePool: async () => {
      throw new Error('pool boom');
    },
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 1_000,
  });

  await handler('SIGTERM');

  assert.deepEqual(exits, [1]);
  assert.ok(events.some((entry) => entry.event === 'shutdown.database_pool_close_failed'));
});

test('a throwing stopBackgroundWork does not abort the drain', async () => {
  const calls = [];
  const exits = [];
  const { events, log } = recorder();
  const handler = createGracefulShutdownHandler({
    stopBackgroundWork: () => {
      throw new Error('timer boom');
    },
    closeServer: async () => calls.push('closeServer'),
    closeDatabasePool: async () => calls.push('closeDatabasePool'),
    exit: (code) => exits.push(code),
    log,
    timeoutMs: 1_000,
  });

  await handler('SIGTERM');

  assert.deepEqual(calls, ['closeServer', 'closeDatabasePool']);
  assert.deepEqual(exits, [1]);
  assert.ok(events.some((entry) => entry.event === 'shutdown.background_work_stop_failed'));
});

test('registerGracefulShutdown subscribes SIGTERM and SIGINT with `on`, so a repeat signal cannot fall through to Node default-kill', () => {
  const registered = [];
  const target = {
    on(signal, listener) {
      registered.push({ signal, listener });
    },
  };
  const seen = [];
  registerGracefulShutdown(async (signal) => {
    seen.push(signal);
  }, target);

  assert.deepEqual(
    registered.map((entry) => entry.signal),
    [...DEFAULT_SHUTDOWN_SIGNALS],
  );
  assert.deepEqual([...DEFAULT_SHUTDOWN_SIGNALS], ['SIGTERM', 'SIGINT']);
  for (const entry of registered) entry.listener();
  assert.deepEqual(seen, ['SIGTERM', 'SIGINT']);
});

// The handler above can only run if the signal reaches the node process at
// all. `CMD ["npm","run","start"]` makes npm PID 1 and node its child; npm
// does not forward SIGTERM, so PID 1 absorbs it and every graceful-shutdown
// guarantee proven by the tests above is dead on arrival in the real image.
// Static check, because nothing at test time can observe the built image.
test('DEPLOYMENT: backend/Dockerfile runs node as PID 1 so SIGTERM reaches the shutdown handler', async () => {
  const dockerfile = await readFile(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const cmd = dockerfile.match(/^CMD .*$/m);
  assert.ok(cmd, 'Dockerfile must declare a CMD');
  assert.equal(cmd[0], 'CMD ["node", "dist/main.js"]');
  assert.doesNotMatch(cmd[0], /npm/, 'npm as PID 1 swallows SIGTERM and never forwards it to node');
  assert.match(cmd[0], /^CMD \[/, 'exec form only -- shell form puts /bin/sh at PID 1 instead');
});

test('the default timeout is bounded well under a typical orchestrator grace period', () => {
  assert.equal(DEFAULT_SHUTDOWN_TIMEOUT_MS, 10_000);
  assert.ok(DEFAULT_SHUTDOWN_TIMEOUT_MS < 30_000);
  assert.equal(typeof CONSOLE_SHUTDOWN_LOGGER.info, 'function');
  assert.equal(typeof CONSOLE_SHUTDOWN_LOGGER.warn, 'function');
});
