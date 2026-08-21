import type { OpaqueProtectionAlertComposer } from './ProtectionAlertProducer.js';

/**
 * PRODUCTION_CRYPTO_SUITE = PENDING_HUMAN_SECURITY_REVIEW (doc 09 PCA-DEC-020).
 *
 * `OpaqueProtectionAlertComposer` exists so PCA-ADD-ENR-020's event-source
 * wiring (ProtectionAlertProducer, RemovalDecisionAuthority.emitAlert, and
 * every real trigger call site) can be built and tested now, with a real
 * encrypted-payload composer substituted later -- the SAME shared
 * CRYPTO_SUITE gate as every other signed-device-identity path in this
 * codebase (device-session issuance, envelope acceptance, signed
 * remote-parent removal decisions, Protective Authority, Safe Zone). See
 * RejectingCryptoVerifiers.ts, this repo's precedent for this exact pattern.
 *
 * This is the PRODUCTION default this module wires into main.ts until that
 * review happens: every composition attempt fails closed by rejecting,
 * never by returning a plausible-looking empty or placeholder payload.
 * ProtectionAlertProducer.produce awaits this composer directly, and every
 * real call site (RemovalDecisionAuthority.emitAlert and its callers) wraps
 * alert emission in a non-blocking try/catch -- so a rejection here means
 * exactly what it should: no alert is ever recorded in production today,
 * while the underlying decision/event this alert would have described still
 * commits correctly. That is the honest state, not a bug to work around.
 * DO NOT replace this with a composer that returns fabricated ciphertext or
 * any other shortcut -- swapping in a reviewed concrete implementation is
 * the only correct fix, and is out of this lane's scope.
 */
export function createRejectingOpaqueProtectionAlertComposer(): OpaqueProtectionAlertComposer {
  return async () => {
    throw new Error('PCA-DEC-020: no reviewed production alert-payload composer is available yet.');
  };
}
