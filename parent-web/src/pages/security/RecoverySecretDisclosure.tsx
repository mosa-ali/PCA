/**
 * PCA-FR-144: this is deliberately a local display component. It does not
 * fetch, render, or accept the Recovery Secret. The warning is shown on the
 * reachable Recovery page before the Owner can begin an authenticated flow.
 */
export function RecoverySecretLossDisclosure() {
  return (
    <aside className="card" aria-labelledby="recovery-secret-loss-title">
      <h2 id="recovery-secret-loss-title">Before you create your Recovery Secret</h2>
      <p>
        PCA infrastructure never receives or stores this secret. Keep it offline and available to the family owner.
      </p>
      <p>
        If you lose the Recovery Secret and all active parent devices, family recovery is permanently impossible. PCA support cannot recover it; start a new family enrollment instead.
      </p>
    </aside>
  );
}
