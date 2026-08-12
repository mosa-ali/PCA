package org.pca.app.runtime.sync

/** Mirrors backend/src/runtime-sync/policy.ts (doc 40 / contracts/runtime-sync/catalogue.json). */
const val MAX_OUTBOUND_BATCH_SIZE: Int = 25

/** Bounds the in-memory "already dispatched to the runtime handler this process lifetime" dedupe set (see ReconnectSyncOrchestrator) -- an unbounded set would itself be an unbounded-growth resource leak across a long-lived process. */
const val MAX_DELIVERED_DEDUPE_ENTRIES: Int = 500
