package org.pca.app.feature.webprotection.policy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * PCA-FR-031A: the web-rule taxonomy must not grow a protected-characteristic
 * category. This exact allowlist makes any new source a deliberate review
 * decision instead of an accidental policy surface.
 */
class WebRuleTaxonomyStaticTest {
    private val approvedSources = setOf(
        WebRuleSource.SECURITY_DENYLIST,
        WebRuleSource.PARENT_ALLOWLIST,
        WebRuleSource.PARENT_DENYLIST,
        WebRuleSource.CATEGORY_RULE,
        WebRuleSource.SCHEDULE_RULE,
    )

    @Test
    fun `web rule sources remain the approved non-protected taxonomy`() {
        assertEquals(approvedSources, WebRuleSource.entries.toSet())
    }

    @Test
    fun `web rule sources contain no protected-characteristic category`() {
        val protectedTerms = setOf("RELIGION", "RACE", "ETHNICITY", "HEALTH", "DISABILITY", "GENDER", "SEXUALITY", "POLITICS", "APPEARANCE")
        val offenders = WebRuleSource.entries.filter { source -> protectedTerms.any { term -> source.name.contains(term) } }
        assertTrue("protected-characteristic web rule sources: $offenders", offenders.isEmpty())
    }
}
