import type { ParentAction, TargetAcknowledgement } from './types.js';

/**
 * PCA-10 defines these as NARROW ports only -- it does not implement
 * pending-envelope queues, hold/drain synchronization, Relay polling,
 * E2EE queue ordering, or message replay ledgers. Those remain PCA-11
 * (Lane 3B). A real implementation of each port is expected to be a thin
 * adapter over familyenvelope's ReceiverPipeline/PARENT_DECISION and
 * relay/RelayService -- this module only needs to CALL these, never own
 * their internals.
 */

/** Delivers an already-authorized ParentAction to its target device(s), e.g. as a signed PARENT_DECISION-routed family envelope over Relay. */
export interface FamilyActionTransport {
  deliver(action: ParentAction): Promise<void>;
}

/** Reports the current best-known delivery status inputs for a previously delivered action -- offline targets, expiry, etc. -- WITHOUT this module polling any queue itself. */
export interface ActionStatusSource {
  getKnownOfflineDeviceIds(familyId: string): Promise<string[]>;
}

/** Supplies target acknowledgements as they become known to the caller (e.g. surfaced by PCA-11's own receipt/ack handling) -- this module only reads what is handed to it via deriveDeliveryStatus. */
export interface ReceiptSource {
  getAcknowledgements(actionId: string): Promise<TargetAcknowledgement[]>;
}
