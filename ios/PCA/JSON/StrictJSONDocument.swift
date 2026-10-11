import Foundation

/// Bounded Foundation-only JSON syntax parser that rejects duplicate object
/// names after decoding their JSON escapes. Feature decoders own their schemas.
enum StrictJSONDocument {
    enum ValidationError: Error { case malformed }
    indirect enum Shape { case object([Data: Shape]), array, null, scalar }

    static func parse(_ data: Data, maximumBytes: Int = 1_048_576) throws -> Shape {
        guard maximumBytes >= 0, data.count <= maximumBytes else { throw ValidationError.malformed }
        var parser = Parser(bytes: Array(data))
        return try parser.document()
    }

    static func validateNoDuplicateMembers(_ data: Data, maximumBytes: Int = 1_048_576) throws {
        _ = try parse(data, maximumBytes: maximumBytes)
    }

    private static func key(_ value: String) -> Data {
        var result = Data()
        for scalar in value.unicodeScalars {
            var encoded = scalar.value.bigEndian
            withUnsafeBytes(of: &encoded) { result.append(contentsOf: $0) }
        }
        return result
    }

    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        mutating func document() throws -> Shape {
            let result = try value(depth: 0)
            whitespace()
            guard index == bytes.count else { throw ValidationError.malformed }
            return result
        }

        private mutating func value(depth: Int) throws -> Shape {
            guard depth <= 64 else { throw ValidationError.malformed }
            whitespace()
            guard index < bytes.count else { throw ValidationError.malformed }
            switch bytes[index] {
            case 0x7B: return try objectValue(depth: depth)
            case 0x5B: return try arrayValue(depth: depth)
            case 0x22: _ = try stringValue(); return .scalar
            case 0x74: try literal("true"); return .scalar
            case 0x66: try literal("false"); return .scalar
            case 0x6E: try literal("null"); return .null
            case 0x2D, 0x30...0x39: try number(); return .scalar
            default: throw ValidationError.malformed
            }
        }

        private mutating func objectValue(depth: Int) throws -> Shape {
            index += 1
            whitespace()
            if take(0x7D) { return .object([:]) }
            var values = [Data: Shape]()
            var names = Set<Data>()
            while true {
                whitespace()
                let name = try stringValue()
                guard names.insert(name).inserted else { throw ValidationError.malformed }
                whitespace()
                guard take(0x3A) else { throw ValidationError.malformed }
                values[name] = try value(depth: depth + 1)
                whitespace()
                if take(0x7D) { return .object(values) }
                guard take(0x2C) else { throw ValidationError.malformed }
            }
        }

        private mutating func arrayValue(depth: Int) throws -> Shape {
            index += 1
            whitespace()
            if take(0x5D) { return .array }
            while true {
                _ = try value(depth: depth + 1)
                whitespace()
                if take(0x5D) { return .array }
                guard take(0x2C) else { throw ValidationError.malformed }
            }
        }

        private mutating func stringValue() throws -> Data {
            let start = index
            guard take(0x22) else { throw ValidationError.malformed }
            while index < bytes.count {
                let byte = bytes[index]
                if byte == 0x22 {
                    index += 1
                    let token = Data(bytes[start..<index])
                    let decoded: String
                    do { decoded = try JSONDecoder().decode(String.self, from: token) }
                    catch { throw ValidationError.malformed }
                    return StrictJSONDocument.key(decoded)
                }
                if byte < 0x20 { throw ValidationError.malformed }
                if byte == 0x5C {
                    index += 1
                    guard index < bytes.count else { throw ValidationError.malformed }
                    if bytes[index] == 0x75 {
                        guard bytes.count - index >= 5 else { throw ValidationError.malformed }
                        index += 5
                    } else {
                        index += 1
                    }
                } else {
                    index += 1
                }
            }
            throw ValidationError.malformed
        }

        private mutating func number() throws {
            _ = take(0x2D)
            guard index < bytes.count else { throw ValidationError.malformed }
            if take(0x30) {
                if index < bytes.count, (0x30...0x39).contains(bytes[index]) { throw ValidationError.malformed }
            } else {
                guard takeDigit(nonZero: true) else { throw ValidationError.malformed }
                while takeDigit() {}
            }
            if take(0x2E) {
                guard takeDigit() else { throw ValidationError.malformed }
                while takeDigit() {}
            }
            if take(0x65) || take(0x45) {
                if !take(0x2B) { _ = take(0x2D) }
                guard takeDigit() else { throw ValidationError.malformed }
                while takeDigit() {}
            }
        }

        private mutating func literal(_ value: String) throws {
            for byte in value.utf8 {
                guard take(byte) else { throw ValidationError.malformed }
            }
        }

        private mutating func takeDigit(nonZero: Bool = false) -> Bool {
            guard index < bytes.count,
                  (nonZero ? (0x31...0x39) : (0x30...0x39)).contains(bytes[index]) else { return false }
            index += 1
            return true
        }

        private mutating func take(_ byte: UInt8) -> Bool {
            guard index < bytes.count, bytes[index] == byte else { return false }
            index += 1
            return true
        }

        private mutating func whitespace() {
            while index < bytes.count && [0x20, 0x09, 0x0A, 0x0D].contains(bytes[index]) { index += 1 }
        }
    }
}
