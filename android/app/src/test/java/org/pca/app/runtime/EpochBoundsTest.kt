package org.pca.app.runtime

import java.math.BigDecimal
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class EpochBoundsTest {
    @Test
    fun `decode accepts the maximum and integral decimal and exponent values`() {
        assertEquals(Int.MAX_VALUE, EpochBounds.decodeJson(JSONObject("""{"epoch":2147483647}"""), "epoch"))
        assertEquals(1, EpochBounds.decodeJson(JSONObject("""{"epoch":1.0}"""), "epoch"))
        assertEquals(1, EpochBounds.decodeJson(JSONObject("""{"epoch":1e0}"""), "epoch"))
    }

    @Test
    fun `decode rejects negative fractional and above maximum values`() {
        for (raw in listOf("-1", "1.5", "2147483648")) {
            assertThrows(JSONException::class.java) {
                EpochBounds.decodeJson(JSONObject("""{"epoch":$raw}"""), "epoch")
            }
        }
    }

    @Test
    fun `decode bounds large decimal before expanding to an integer`() {
        val json = JSONObject().put("epoch", BigDecimal("1E+100000"))
        assertThrows(JSONException::class.java) {
            EpochBounds.decodeJson(json, "epoch")
        }
    }
}
