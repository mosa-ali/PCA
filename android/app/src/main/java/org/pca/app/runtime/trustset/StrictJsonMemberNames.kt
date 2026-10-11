package org.pca.app.runtime.trustset

/** Validates JSON syntax and duplicate names before JSONObject's permissive parser reads persisted state. */
internal object StrictJsonMemberNames {
    fun requireUnique(source: String) = Scanner(source).scan()

    private class Scanner(private val source: String) {
        private var offset = 0

        fun scan() {
            whitespace()
            value(0)
            whitespace()
            require(offset == source.length) { "invalid_ordinary_trust_set_state" }
        }

        private fun value(depth: Int) {
            require(depth <= MAX_DEPTH) { "invalid_ordinary_trust_set_state" }
            whitespace()
            require(offset < source.length) { "invalid_ordinary_trust_set_state" }
            when (source[offset]) {
                '{' -> objectValue(depth + 1)
                '[' -> arrayValue(depth + 1)
                '"' -> stringValue()
                't' -> literal("true")
                'f' -> literal("false")
                'n' -> literal("null")
                '-', in '0'..'9' -> numberValue()
                else -> invalid()
            }
        }

        private fun objectValue(depth: Int) {
            offset++
            whitespace()
            if (consume('}')) return
            val names = HashSet<String>()
            while (true) {
                whitespace()
                require(offset < source.length && source[offset] == '"') { "invalid_ordinary_trust_set_state" }
                require(names.add(stringValue())) { "duplicate_ordinary_trust_set_member" }
                whitespace()
                expect(':')
                value(depth)
                whitespace()
                if (consume('}')) return
                expect(',')
            }
        }

        private fun arrayValue(depth: Int) {
            offset++
            whitespace()
            if (consume(']')) return
            while (true) {
                value(depth)
                whitespace()
                if (consume(']')) return
                expect(',')
            }
        }

        private fun stringValue(): String {
            expect('"')
            val result = StringBuilder()
            while (offset < source.length) {
                val character = source[offset++]
                when {
                    character == '"' -> return result.toString()
                    character == '\\' -> {
                        require(offset < source.length) { "invalid_ordinary_trust_set_state" }
                        when (val escaped = source[offset++]) {
                            '"', '\\', '/' -> result.append(escaped)
                            'b' -> result.append('\b')
                            'f' -> result.append('\u000c')
                            'n' -> result.append('\n')
                            'r' -> result.append('\r')
                            't' -> result.append('\t')
                            'u' -> {
                                require(offset + 4 <= source.length) { "invalid_ordinary_trust_set_state" }
                                val codeUnit = source.substring(offset, offset + 4).toIntOrNull(16)
                                    ?: error("invalid_ordinary_trust_set_state")
                                offset += 4
                                when {
                                    codeUnit in HIGH_SURROGATE_START..HIGH_SURROGATE_END -> {
                                        require(offset + 6 <= source.length && source[offset] == '\\' && source[offset + 1] == 'u') {
                                            "invalid_ordinary_trust_set_state"
                                        }
                                        val lowSurrogate = source.substring(offset + 2, offset + 6).toIntOrNull(16)
                                            ?: error("invalid_ordinary_trust_set_state")
                                        require(lowSurrogate in LOW_SURROGATE_START..LOW_SURROGATE_END) {
                                            "invalid_ordinary_trust_set_state"
                                        }
                                        result.append(codeUnit.toChar()).append(lowSurrogate.toChar())
                                        offset += 6
                                    }
                                    codeUnit in LOW_SURROGATE_START..LOW_SURROGATE_END -> invalid()
                                    else -> result.append(codeUnit.toChar())
                                }
                            }
                            else -> error("invalid_ordinary_trust_set_state")
                        }
                    }
                    character.code < 0x20 -> invalid()
                    character.isHighSurrogate() -> {
                        require(offset < source.length && source[offset].isLowSurrogate()) {
                            "invalid_ordinary_trust_set_state"
                        }
                        result.append(character).append(source[offset++])
                    }
                    character.isLowSurrogate() -> invalid()
                    else -> result.append(character)
                }
            }
            invalid()
        }

        private fun literal(expected: String) {
            require(source.regionMatches(offset, expected, 0, expected.length)) {
                "invalid_ordinary_trust_set_state"
            }
            offset += expected.length
        }

        private fun numberValue() {
            consume('-')
            require(offset < source.length) { "invalid_ordinary_trust_set_state" }
            when (source[offset]) {
                '0' -> {
                    offset++
                    // A leading zero cannot be followed by another integer digit.
                    require(offset == source.length || source[offset] !in '0'..'9') {
                        "invalid_ordinary_trust_set_state"
                    }
                }
                in '1'..'9' -> {
                    offset++
                    while (offset < source.length && source[offset] in '0'..'9') offset++
                }
                else -> invalid()
            }
            if (consume('.')) {
                require(offset < source.length && source[offset] in '0'..'9') {
                    "invalid_ordinary_trust_set_state"
                }
                while (offset < source.length && source[offset] in '0'..'9') offset++
            }
            if (consume('e') || consume('E')) {
                if (!consume('+')) consume('-')
                require(offset < source.length && source[offset] in '0'..'9') {
                    "invalid_ordinary_trust_set_state"
                }
                while (offset < source.length && source[offset] in '0'..'9') offset++
            }
        }

        private fun invalid(): Nothing = error("invalid_ordinary_trust_set_state")

        private fun consume(character: Char): Boolean {
            if (offset >= source.length || source[offset] != character) return false
            offset++
            return true
        }

        private fun whitespace() {
            while (offset < source.length &&
                (source[offset] == ' ' || source[offset] == '\t' || source[offset] == '\r' || source[offset] == '\n')
            ) offset++
        }

        private fun expect(character: Char) {
            require(consume(character)) { "invalid_ordinary_trust_set_state" }
        }

    }

    private const val MAX_DEPTH = 64
    private const val HIGH_SURROGATE_START = 0xd800
    private const val HIGH_SURROGATE_END = 0xdbff
    private const val LOW_SURROGATE_START = 0xdc00
    private const val LOW_SURROGATE_END = 0xdfff
}
