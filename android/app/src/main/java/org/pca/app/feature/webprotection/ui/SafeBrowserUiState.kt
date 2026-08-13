package org.pca.app.feature.webprotection.ui

import org.pca.app.feature.webprotection.safebrowser.BlockDecisionState

/** doc 15's held-page/Ask-Parent lifecycle -- mirrors [org.pca.app.runtime.child.ChildRequestLocalStatus]'s own PENDING_SYNC_LOCAL vocabulary so this screen never invents a second status model. */
enum class AskParentState {
    NONE,
    NOT_REQUESTABLE,
    /** doc 19: queued locally; not yet handed to the family sync transport (offline, or not yet flushed). */
    PENDING_SYNC_LOCAL,
    /** Handed to [org.pca.app.runtime.port.FamilySyncRuntimePort] successfully -- still awaiting a parent decision, but delivery itself is confirmed. */
    SUBMITTED_TO_PARENT,
    ALREADY_PENDING,
}

sealed class SafeBrowserScreenState {
    data class Browsing(val currentUrl: String?, val canGoBack: Boolean, val isLoading: Boolean) : SafeBrowserScreenState()
    data class Held(val decision: BlockDecisionState, val askParentState: AskParentState) : SafeBrowserScreenState()
}

/**
 * doc 13/14's honest coverage banner: whether family-authored (parent
 * allow/deny) rules are actually being evaluated for this session, or only
 * the family-agnostic global security feed (Safe Limited Mode) because
 * [org.pca.app.feature.webprotection.identity.WebProtectionIdentity.TrustedFamilyContextUnavailable].
 * Never silently claimed as full coverage when it is not.
 */
enum class WebProtectionCoverage { FULL_FAMILY_POLICY, SAFE_LIMITED_MODE_GLOBAL_ONLY }
