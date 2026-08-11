import type { DeleteNowLedger, DeleteNowRecord } from './DeleteNowLedger.js';
import type { PurgePlan } from './engine.js';

export class InMemoryDeleteNowLedger implements DeleteNowLedger {
  private readonly records = new Map<string, DeleteNowRecord>();

  get(actionId: string): DeleteNowRecord | null {
    return this.records.get(actionId) ?? null;
  }

  record(actionId: string, plan: PurgePlan, completedAtUtc: Date): void {
    if (this.records.has(actionId)) return; // first completion wins -- see applyDeleteNow's idempotency contract
    this.records.set(actionId, { actionId, completedAtUtc, plan });
  }
}
