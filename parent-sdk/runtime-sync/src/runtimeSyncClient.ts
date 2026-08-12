import { computeSyncConnectionState } from './connectionState.js';
import type { RuntimeSyncTransport } from './transport.js';
import type {
  DeviceSession,
  OutboundBatchResult,
  OutboundEnvelopeInput,
  OutboundItemOutcome,
  ReconnectDrainResult,
  SyncConnectionState,
} from './types.js';

export class RuntimeSyncClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeSyncClientError';
  }
}

/**
 * Parent-side facade over RuntimeSyncTransport (doc 40 Section 25): send/
 * retrieve/acknowledge, plus local, honest connection-state bookkeeping
 * (never LIVE from a successful HTTP round-trip alone -- see
 * connectionState.ts). This class owns no durable queue itself: `pendingCount`
 * is caller-supplied bookkeeping (the caller's own outbox is the source of
 * truth for what's pending), consistent with parent-web/Agent 13 owning
 * actual persistence, not this SDK.
 */
export class RuntimeSyncClient {
  private session: DeviceSession | null = null;
  private lastSuccessfulSyncAtUtc: Date | null = null;
  private pendingCount = 0;
  private syncing = false;

  constructor(
    private readonly transport: RuntimeSyncTransport,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async authenticate(deviceId: string, sign: (nonce: string) => Promise<string>): Promise<void> {
    const challenge = await this.transport.issueChallenge(deviceId);
    const signature = await sign(challenge.nonce);
    this.session = await this.transport.completeChallenge(deviceId, challenge.challengeId, signature);
  }

  isAuthenticated(): boolean {
    return this.session !== null && new Date(this.session.expiresAt).getTime() > this.now().getTime();
  }

  private requireSessionToken(): string {
    if (!this.isAuthenticated()) throw new RuntimeSyncClientError('Not authenticated -- call authenticate() first.');
    return (this.session as DeviceSession).sessionToken;
  }

  /** Caller-owned bookkeeping -- update this whenever the caller's own durable outbox size changes, so getConnectionState() reflects real pending work. */
  setPendingCount(count: number): void {
    this.pendingCount = count;
  }

  getPendingCount(): number {
    return this.pendingCount;
  }

  getLastSuccessfulSyncAtUtc(): Date | null {
    return this.lastSuccessfulSyncAtUtc;
  }

  async sendEnvelope(item: OutboundEnvelopeInput): Promise<OutboundItemOutcome> {
    const result = await this.sendBatch([item]);
    return result.results[0];
  }

  async sendBatch(items: readonly OutboundEnvelopeInput[]): Promise<OutboundBatchResult> {
    const token = this.requireSessionToken();
    this.syncing = true;
    try {
      const result = await this.transport.submitOutbound(token, items);
      this.lastSuccessfulSyncAtUtc = this.now();
      return result;
    } finally {
      this.syncing = false;
    }
  }

  async retrieve(): Promise<ReconnectDrainResult> {
    const token = this.requireSessionToken();
    this.syncing = true;
    try {
      const result = await this.transport.listInbound(token);
      this.lastSuccessfulSyncAtUtc = this.now();
      return result;
    } finally {
      this.syncing = false;
    }
  }

  async acknowledge(messageId: string): Promise<void> {
    const token = this.requireSessionToken();
    await this.transport.acknowledgeInbound(token, messageId);
  }

  /** Local, honest connection state (doc 40 Section 2) -- never LIVE purely because the last HTTP call happened to succeed; requires a RECENT successful sync. */
  getConnectionState(nowUtc: Date = this.now()): SyncConnectionState {
    return computeSyncConnectionState({
      isTransportConnected: this.isAuthenticated(),
      isSyncing: this.syncing,
      hasPendingLocalWork: this.pendingCount > 0,
      lastSuccessfulSyncAtUtc: this.lastSuccessfulSyncAtUtc,
      nowUtc,
    });
  }

  /** Server-observed status (best-effort courtesy view -- see backend StatusService's own doc comment) -- distinct from, and never a substitute for, getConnectionState()'s local computation. */
  async fetchRemoteStatus(): Promise<SyncConnectionState> {
    const token = this.requireSessionToken();
    const result = await this.transport.getStatus(token);
    return result.connectionState;
  }
}
