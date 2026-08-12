import { useCallback, useState } from 'react';
import {
  applyChildApplicationReceipt,
  canTransition,
  initialStatusAfterSubmit,
  type PolicyStatusSnapshot,
} from '../domain/policyStatus';

export interface UsePolicyStatusResult {
  snapshot: PolicyStatusSnapshot | null;
  /**
   * Call the instant a save is initiated (before/instead of the network
   * call), so the UI reflects the honest in-flight state immediately.
   * `wasOffline` selects LOCAL_DRAFT vs PENDING_SYNC per
   * ../domain/policyStatus.ts -- never call this with the intent to render
   * APPLIED.
   */
  beginSubmit: (wasOffline: boolean, policyRevision?: number | null) => void;
  /**
   * Call once the update request has actually been accepted by the
   * (fixture or real) gateway -- transitions PENDING_SYNC -> PENDING_DELIVERY.
   * This means "handed off for delivery to the device", never "applied".
   */
  markQueuedForDelivery: () => void;
  /** Call on a submit failure. `reason` must be a short, non-sensitive category, never raw error text. */
  markFailed: (reason: string) => void;
  /**
   * Seam for a future child-application receipt (see
   * ../domain/policyStatus.ts:applyChildApplicationReceipt). Not invoked by
   * any caller in this repository slice yet -- there is no receipt source
   * until Agent 16's backend relay lands. A future coordinator wires a real
   * receipt event into this call; it must never be called speculatively.
   */
  applyReceipt: (receipt: { appliedRevision: number; acknowledgedAtUtc: string }) => void;
}

const nowIso = () => new Date().toISOString();

/**
 * In-memory (session-only -- not persisted across a browser refresh; no
 * backend exists in this repository slice to persist against, see
 * docs/architecture) policy-status tracker for a single policy-editing
 * page. Wraps the canonical state machine in ../domain/policyStatus.ts and
 * never performs a transition that table disallows. Intended to be reused
 * by future policy-editing pages beyond ScreenTimePage (app rules, web
 * protection, etc.) once they grow the same "save now needs to reflect an
 * honest delivery/application status" requirement.
 */
export function usePolicyStatus(): UsePolicyStatusResult {
  const [snapshot, setSnapshot] = useState<PolicyStatusSnapshot | null>(null);

  const beginSubmit = useCallback((wasOffline: boolean, policyRevision: number | null = null) => {
    setSnapshot((prev) => ({
      status: initialStatusAfterSubmit(wasOffline),
      policyRevision: policyRevision ?? prev?.policyRevision ?? null,
      lastAppliedRevision: prev?.lastAppliedRevision ?? null,
      updatedAtUtc: nowIso(),
      failureReason: null,
    }));
  }, []);

  const markQueuedForDelivery = useCallback(() => {
    setSnapshot((prev) => {
      if (!prev || !canTransition(prev.status, 'PENDING_DELIVERY')) return prev;
      return { ...prev, status: 'PENDING_DELIVERY', updatedAtUtc: nowIso() };
    });
  }, []);

  const markFailed = useCallback((reason: string) => {
    setSnapshot((prev) => {
      if (!prev || !canTransition(prev.status, 'FAILED')) return prev;
      return { ...prev, status: 'FAILED', failureReason: reason, updatedAtUtc: nowIso() };
    });
  }, []);

  const applyReceipt = useCallback((receipt: { appliedRevision: number; acknowledgedAtUtc: string }) => {
    setSnapshot((prev) => (prev ? applyChildApplicationReceipt(prev, receipt) : prev));
  }, []);

  return { snapshot, beginSubmit, markQueuedForDelivery, markFailed, applyReceipt };
}
