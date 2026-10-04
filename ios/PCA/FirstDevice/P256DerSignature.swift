import Foundation

public enum P256DerSignatureError: Error, Equatable {
    /// The DER input is not exactly one SEQUENCE of two positive INTEGERs,
    /// or a scalar is zero / out of the P-256 range. Fail closed: callers
    /// treat this as an internal invariant violation and never emit a
    /// repaired signature.
    case malformedDer
}

/// WAVE 6D: Secure Enclave (and Security-framework ECDSA in general)
/// returns signatures in DER (`SEQUENCE { INTEGER r, INTEGER s }`), while
/// the certified backend acceptance surface requires the fixed-width
/// IEEE-P1363 form (`r || s`, exactly 64 bytes) in LOW-S canonical form
/// (`s <= n/2`), unpadded base64url applied by the caller -- the exact
/// surface of `backend/src/deviceauth/P256DeviceSignatureVerifier.ts` and
/// `backend/src/familytrustset/P256TrustSetSignatureVerifier.ts`.
///
/// This converter is strict and total: it parses exactly one SEQUENCE
/// containing exactly two positive INTEGERs (1...33 content bytes each,
/// short/long-form lengths up to 4 length bytes), rejects negative/zero
/// scalars, out-of-range scalars, and trailing bytes, and normalizes
/// high-S to `n - s`. It never signs, recovers, or synthesizes a
/// signature. Semantics mirror the Android converter
/// (`android/.../firstdevice/P256DerSignature.kt`) byte for byte; the
/// half-order constant is pinned by a test that re-derives
/// `n = 2 * (n/2) + 1`.
public enum P256DerSignature {
    /// P-256 group order `n` (SEC2 / FIPS 186-4), identical to the backend
    /// and Android constants.
    public static var order: Data { Data(orderBytes) }
    /// floor(n/2), the low-S bound the backend enforces (`s <= n/2`).
    public static var halfOrder: Data { Data(halfOrderBytes) }

    /// Converts one DER ECDSA signature to canonical 64-byte low-S
    /// IEEE-P1363 (`r || s`).
    public static func toLowSIeeeP1363(der: Data) throws -> Data {
        let scalars = try parseDerSignature(der)
        guard isInRange(scalars.r) else { throw P256DerSignatureError.malformedDer }
        guard isInRange(scalars.s) else { throw P256DerSignatureError.malformedDer }
        let lowS = compare(scalars.s, halfOrderBytes) > 0 ? subtract(orderBytes, scalars.s) : scalars.s
        var out = Data()
        out.append(contentsOf: scalars.r)
        out.append(contentsOf: lowS)
        return out
    }

    /// True when a 64-byte IEEE-P1363 signature already satisfies the
    /// backend's `s <= n/2` acceptance rule (tests and diagnostics only).
    public static func isLowS(_ p1363: Data) -> Bool {
        guard p1363.count == 64 else { return false }
        return compare([UInt8](p1363[32..<64]), halfOrderBytes) <= 0
    }

    // MARK: - Strict DER parsing

    private static func parseDerSignature(_ der: Data) throws -> (r: [UInt8], s: [UInt8]) {
        let bytes = [UInt8](der)
        var cursor = 0

        func readByte() throws -> UInt8 {
            guard cursor < bytes.count else { throw P256DerSignatureError.malformedDer }
            let value = bytes[cursor]
            cursor += 1
            return value
        }

        func readLength() throws -> Int {
            let first = try readByte()
            if first & 0x80 == 0 { return Int(first) }
            let count = Int(first & 0x7f)
            guard (1...4).contains(count) else { throw P256DerSignatureError.malformedDer }
            var length = 0
            for _ in 0..<count {
                length = (length << 8) | Int(try readByte())
            }
            return length
        }

        func readInteger() throws -> [UInt8] {
            guard try readByte() == 0x02 else { throw P256DerSignatureError.malformedDer }
            let length = try readLength()
            guard (1...33).contains(length) else { throw P256DerSignatureError.malformedDer }
            guard cursor + length <= bytes.count else { throw P256DerSignatureError.malformedDer }
            guard bytes[cursor] & 0x80 == 0 else { throw P256DerSignatureError.malformedDer }
            let content = Array(bytes[cursor..<(cursor + length)])
            cursor += length
            return content
        }

        guard try readByte() == 0x30 else { throw P256DerSignatureError.malformedDer }
        let sequenceLength = try readLength()
        guard cursor + sequenceLength == bytes.count else { throw P256DerSignatureError.malformedDer }
        let rContent = try readInteger()
        let sContent = try readInteger()
        guard cursor == bytes.count else { throw P256DerSignatureError.malformedDer }
        return try (normalizeFixed32(rContent), normalizeFixed32(sContent))
    }

    /// Strips leading zero bytes and left-pads to exactly 32 bytes.
    private static func normalizeFixed32(_ content: [UInt8]) throws -> [UInt8] {
        var value = content
        while value.count > 1, value[0] == 0x00 {
            value.removeFirst()
        }
        guard value.count <= 32 else { throw P256DerSignatureError.malformedDer }
        if value.count == 32 { return value }
        return [UInt8](repeating: 0, count: 32 - value.count) + value
    }

    private static func isInRange(_ fixed32: [UInt8]) -> Bool {
        guard fixed32.contains(where: { $0 != 0x00 }) else { return false }
        return compare(fixed32, orderBytes) < 0
    }

    // MARK: - Big-endian byte helpers (fixed width)

    private static func compare(_ lhs: [UInt8], _ rhs: [UInt8]) -> Int {
        guard lhs.count == rhs.count else { return lhs.count < rhs.count ? -1 : 1 }
        for index in 0..<lhs.count where lhs[index] != rhs[index] {
            return lhs[index] < rhs[index] ? -1 : 1
        }
        return 0
    }

    private static func subtract(_ lhs: [UInt8], _ rhs: [UInt8]) -> [UInt8] {
        var result = [UInt8](repeating: 0, count: lhs.count)
        var borrow = 0
        for index in stride(from: lhs.count - 1, through: 0, by: -1) {
            var difference = Int(lhs[index]) - Int(rhs[index]) - borrow
            if difference < 0 {
                difference += 256
                borrow = 1
            } else {
                borrow = 0
            }
            result[index] = UInt8(difference)
        }
        return result
    }

    private static func hexBytes(_ hex: String) -> [UInt8] {
        var bytes: [UInt8] = []
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            bytes.append(UInt8(hex[index..<next], radix: 16) ?? 0)
            index = next
        }
        return bytes
    }

    private static let orderBytes: [UInt8] = hexBytes(
        "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"
    )
    private static let halfOrderBytes: [UInt8] = hexBytes(
        "7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8"
    )
}
