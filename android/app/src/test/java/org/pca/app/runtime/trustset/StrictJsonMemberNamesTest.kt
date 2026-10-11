package org.pca.app.runtime.trustset

import org.junit.Assert.fail
import org.junit.Test

class StrictJsonMemberNamesTest {
    @Test fun acceptsOnlyStrictJsonValuesAndWhitespace() {
        StrictJsonMemberNames.requireUnique(
            """ {"quoted":"value","escaped":"\u0061","emoji":"\uD83D\uDE00","values":[true,false,null,-2,0,12.5,3e-2]} """
        )
    }

    @Test fun rejectsPermissiveBareValuesAndSingleQuotedForms() {
        listOf(
            "{'version':3}",
            "{\"version\":NaN}",
            "{\"version\":Infinity}",
            "{\"version\":undefined}",
            "{\"version\":True}",
            "{\"version\":truthy}",
        ).forEach(::assertInvalid)
    }

    @Test fun rejectsMalformedNumbers() {
        listOf(
            "01",
            "-",
            ".5",
            "1.",
            "1e",
            "1e+",
            "1e-",
            "+1",
            "--1",
        ).forEach(::assertInvalid)
    }

    @Test fun rejectsMalformedEscapesAndTrailingCommas() {
        listOf(
            "{\"key\\q\":1}",
            "{\"key\":\"bad\\x20escape\"}",
            "{\"key\":1,}",
            "[1,]",
            """{"emoji":"\uD83D"}""",
            """{"emoji":"\uDE00"}""",
            """{"emoji":"\uD83D\u0041"}""",
        ).forEach(::assertInvalid)
    }

    @Test fun acceptsEscapedSurrogatePair() {
        StrictJsonMemberNames.requireUnique("""{"emoji":"\uD83D\uDE00"}""")
    }

    @Test fun rejectsDuplicateKeysAfterUnicodeEscapeDecoding() {
        assertInvalid("{\"epoch\":1,\"ep\\u006fch\":2}")
    }

    private fun assertInvalid(source: String) {
        try {
            StrictJsonMemberNames.requireUnique(source)
            fail("malformed or ambiguous JSON was accepted: $source")
        } catch (_: IllegalArgumentException) {
            // Expected for failed grammar requirements and duplicate names.
        } catch (_: IllegalStateException) {
            // Expected for invalid escape/control sequences.
        }
    }
}
