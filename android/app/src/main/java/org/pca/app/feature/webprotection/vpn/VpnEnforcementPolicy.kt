package org.pca.app.feature.webprotection.vpn

/**
 * PCA-DW-W3-G / ANDROID_VPN_DNS_POLICY: third-party DNS/VPN enforcement
 * remains OWNER_DECISION_PENDING -- this policy gate must be explicitly
 * approved before [VpnEnforcementController] may ever start real
 * enforcement. No production call site anywhere in this codebase sets
 * `ownerApproved = true`; this exists purely so the controller (and any
 * future caller/test) can confirm the feature stays inert absent that
 * decision, mirroring [org.pca.app.feature.youtube.policy.isModeBActive]'s
 * gate for the exact same reason: dormancy should be an explicit,
 * checkable property of the code itself, not merely "no settings screen
 * calls requestStart() yet."
 */
data class VpnEnforcementPolicy(val ownerApproved: Boolean = false)

/** The only zero-argument way to obtain a policy state in this module -- always dormant. */
fun defaultVpnEnforcementPolicy(): VpnEnforcementPolicy = VpnEnforcementPolicy(ownerApproved = false)
