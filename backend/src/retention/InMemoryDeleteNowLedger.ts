import type { DeleteNowLedger, DeleteNowRecord } from './DeleteNowLedger.js';
import { clonePurgePlan, type PurgePlan } from './engine.js';

export class InMemoryDeleteNowLedger implements DeleteNowLedger {
  private readonly records = new Map<string, DeleteNowRecord>();

  get(actionId: string): DeleteNowRecord | null {
    const record = this.records.get(actionId);
    return record ? { ...record, completedAtUtc: new Date(record.completedAtUtc.getTime()), plan: clonePurgePlan(record.plan) } : null;
  }

  record(actionId: string, plan: PurgePlan, completedAtUtc: Date): void {
    if (this.records.has(actionId)) return; // first completion wins -- see applyDeleteNow's idempotency contract
    this.records.set(actionId, { actionId, completedAtUtc: new Date(completedAtUtc.getTime()), plan: clonePurgePlan(plan) });
  }
}
