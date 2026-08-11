import type { ChildRequest } from './types.js';

/**
 * Narrow port only -- delivering a submitted request to authorized parent
 * devices (e.g. as a signed CHILD_REQUEST family envelope) and receiving
 * PARENT_DECISION replies is PCA-11/Lane 3B's transport concern. This
 * module never implements queueing, Relay polling, or replay ledgers
 * itself (lane brief Section 10).
 */
export interface ChildRequestTransport {
  submit(request: ChildRequest): Promise<void>;
  notifyDecision(request: ChildRequest): Promise<void>;
}
