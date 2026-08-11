package org.pca.app.platform

import android.content.Intent

enum class VpnConnectionState { DISCONNECTED, CONNECTING, CONNECTED, ERROR }

/**
 * Adapter over the platform's VPN-based web-filtering CAPABILITY
 * (permission + connection lifecycle) -- doc 06 Section 6 / PCA-SEC-002.
 * This is the FOUNDATION layer only: permission check/request and
 * connection-state reporting. It deliberately does NOT include the actual
 * traffic-filtering VpnService/tunnel implementation or any classification
 * logic -- that is PCA-5 (Web filtering and PCA Safe Browser) scope, built
 * on top of this contract, not duplicated here.
 *
 * Hard constraints on ANY future implementation of the VpnService this
 * interface fronts (doc 06 Section 6, restated here so PCA-5 inherits them
 * without re-deriving):
 *  - MUST run as a foreground service with a persistent, non-hideable
 *    notification while connected.
 *  - NO covert TLS MITM ever.
 *  - Classification is on-device only -- no egress to any PCA server or
 *    third party for a filtering decision. This interface's surface
 *    intentionally has no "submit this URL/host to a server" method; do
 *    not add one to satisfy a future feature without revisiting this
 *    constraint explicitly.
 */
interface VpnCapabilitySource {
    /**
     * Re-queries platform permission state live -- never a cached flag.
     * Deliberately a boolean, unlike [UsageAccessState]'s multi-valued
     * model: `VpnService.prepare()` is the ONLY signal Android exposes to
     * a Standard Mode app about VPN consent -- there is no richer
     * platform-level enum (e.g. distinguishing "revoked" from "never
     * asked," or "locked down by another always-on VPN app") available
     * without device-owner authority. Modeling a richer state here would
     * fabricate a distinction this API cannot actually back with
     * evidence.
     */
    fun isPermissionGranted(): Boolean
    /** Service lifecycle state -- PCA-5's concrete VpnService implementation is expected to report every transition here via a state-update hook (see [StandardVpnCapabilitySource.updateState]) as it actually happens, not on a polling/inferred basis. */
    fun connectionState(): VpnConnectionState
    /** Returns the platform consent Intent to launch if permission is not yet granted (VpnService.prepare), or null if already granted. */
    fun createConsentIntentIfNeeded(): Intent?
}

/**
 * REVIEW NOTE (PCA-5 consumption readiness): this foundation's surface --
 * consent state + lifecycle state, nothing else -- is intentionally the
 * full extent of what belongs at the PCA-2 layer. The remaining PCA-5
 * concerns this contract must support without modification here:
 *  - "metadata-only domain decision consumption": PCA-5's VpnService
 *    implementation classifies traffic ENTIRELY on-device and applies
 *    allow/block decisions to the tunnel itself -- this foundation never
 *    sees or needs to see individual domain/decision pairs, so there is
 *    nothing for this layer to expose for that purpose beyond the
 *    lifecycle-state channel already here (e.g. reporting the tunnel is
 *    CONNECTED and therefore actively enforcing). Adding a decision-level
 *    API here would misplace feature logic into the platform-foundation
 *    layer.
 *  - No TLS interception/payload inspection capability exists in, or is
 *    reachable from, this interface -- there is no method here that could
 *    be used to extract or forward decrypted payload content, by
 *    construction.
 */

