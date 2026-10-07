import Foundation

public enum TrustSetRole: String, Decodable { case owner = "OWNER", administrator = "ADMINISTRATOR", viewer = "VIEWER", child = "CHILD" }
public enum TrustSetMembershipStatus: String, Decodable {
    case active = "ACTIVE", rotationPending = "ROTATION_PENDING", deviceOffline = "DEVICE_OFFLINE"
    case revoked = "REVOKED", epochStale = "EPOCH_STALE", recoveryRequired = "RECOVERY_REQUIRED"
}

/// Structural membership candidate only; these statuses never set the device lifecycle.
public struct UntrustedTrustSetEntry: Decodable {
    public let deviceId: String
    public let role: TrustSetRole
    public let dskKeyId: String
    public let dskPublicKey: String
    public let dekKeyId: String
    public let dekPublicKey: String
    public let status: TrustSetMembershipStatus

    public init(deviceId: String, role: TrustSetRole, dskKeyId: String, dskPublicKey: String,
                dekKeyId: String, dekPublicKey: String, status: TrustSetMembershipStatus) {
        self.deviceId = deviceId; self.role = role; self.dskKeyId = dskKeyId; self.dskPublicKey = dskPublicKey
        self.dekKeyId = dekKeyId; self.dekPublicKey = dekPublicKey; self.status = status
    }
}

/// No accepted epoch, verified signer, anchor, floor, ACK or policy authority is represented here.
/// Deliberately not Equatable: Swift's normalized String equality is unsuitable for opaque identity.
public struct UntrustedTrustSetEpoch {
    public let familyId: String
    public let trustSetEpoch: Int
    public let keyEpoch: Int
    public let entries: [UntrustedTrustSetEntry]
    /// Exact backend Date.toISOString representation, including signed six-digit years.
    public let issuedAt: String
    public let supersedesEpoch: Int?
    /// Canonical bytes contain no signature; canonical decoding returns an empty value.
    public let signature: String

    public init(familyId: String, trustSetEpoch: Int, keyEpoch: Int, entries: [UntrustedTrustSetEntry],
                issuedAt: String, supersedesEpoch: Int?, signature: String = "") {
        self.familyId = familyId; self.trustSetEpoch = trustSetEpoch; self.keyEpoch = keyEpoch
        self.entries = entries; self.issuedAt = issuedAt; self.supersedesEpoch = supersedesEpoch; self.signature = signature
    }
}

public enum TrustSetCodecError: Error { case malformedUntrustedTrustSet }

/// Backend familytrustset structural grammar only. Decoding never verifies or applies anything.
public enum FamilyTrustSetCodec {
    public static let maximumCanonicalUTF16Units = 262144
    private static let maximumWireUTF16Units = 1048576
    private static let maximumEpoch = Int(Int32.max)

    public static func parseWire(_ data: Data) throws -> UntrustedTrustSetEpoch {
        try checked {
            guard data.count <= maximumWireUTF16Units * 3 else { throw malformed }
            let text = try strictUTF8(Array(data))
            guard text.utf16.count <= maximumWireUTF16Units else { throw malformed }
            // JSONDecoder's strict string decoding rejects unpaired surrogate escapes;
            // do not use String(decoding:) or a replacement-based JSON string adapter.
            let wire = try JSONDecoder().decode(WireEpoch.self, from: data)
            let epoch = UntrustedTrustSetEpoch(familyId: wire.familyId, trustSetEpoch: wire.trustSetEpoch,
                keyEpoch: wire.keyEpoch, entries: wire.entries, issuedAt: wire.issuedAt,
                supersedesEpoch: wire.supersedesEpoch, signature: wire.signature)
            try validate(epoch)
            guard (1...512).contains(epoch.signature.utf16.count) else { throw malformed }
            return epoch
        }
    }

    public static func canonicalize(_ epoch: UntrustedTrustSetEpoch) throws -> Data {
        try checked {
            try validate(epoch)
            var fields = [epoch.familyId, String(epoch.trustSetEpoch), String(epoch.keyEpoch), String(epoch.entries.count)]
            for entry in epoch.entries {
                fields += [entry.deviceId, entry.role.rawValue, entry.dskKeyId, entry.dskPublicKey,
                           entry.dekKeyId, entry.dekPublicKey, entry.status.rawValue]
            }
            fields += [epoch.issuedAt, epoch.supersedesEpoch.map(String.init) ?? "null"]
            // Explicit field list deliberately excludes the signature.
            let text = fields.map { "\($0.utf8.count):\($0)" }.joined()
            guard text.utf16.count <= maximumCanonicalUTF16Units else { throw malformed }
            return Data(text.utf8)
        }
    }

    public static func decodeCanonical(_ data: Data) throws -> UntrustedTrustSetEpoch {
        try checked {
            guard data.count <= maximumCanonicalUTF16Units * 3 else { throw malformed }
            let bytes = Array(data)
            let text = try strictUTF8(bytes)
            guard text.utf16.count <= maximumCanonicalUTF16Units else { throw malformed }
            var cursor = 0
            func field() throws -> String {
                let start = cursor
                while cursor < bytes.count && (48...57).contains(bytes[cursor]) { cursor += 1 }
                guard cursor > start, cursor < bytes.count, bytes[cursor] == 58,
                      let prefix = String(data: Data(bytes[start..<cursor]), encoding: .ascii) else { throw malformed }
                let length = try integer(prefix, minimum: 0)
                cursor += 1
                guard length <= bytes.count - cursor else { throw malformed }
                let value = try strictUTF8(Array(bytes[cursor..<(cursor + length)]))
                cursor += length
                return value
            }
            let family = try field()
            let trust = try integer(field(), minimum: 1)
            let key = try integer(field(), minimum: 0)
            let count = try integer(field(), minimum: 1)
            guard count <= 64 else { throw malformed }
            var entries: [UntrustedTrustSetEntry] = []
            for _ in 0..<count {
                let device = try field()
                guard let role = TrustSetRole(rawValue: try field()) else { throw malformed }
                let dskId = try field(), dsk = try field(), dekId = try field(), dek = try field()
                guard let status = TrustSetMembershipStatus(rawValue: try field()) else { throw malformed }
                entries.append(UntrustedTrustSetEntry(deviceId: device, role: role, dskKeyId: dskId,
                    dskPublicKey: dsk, dekKeyId: dekId, dekPublicKey: dek, status: status))
            }
            let date = try field()
            let priorToken = try field()
            let previous: Int?
            if priorToken == "null" { previous = nil } else { previous = try integer(priorToken, minimum: 1) }
            guard cursor == bytes.count else { throw malformed }
            let epoch = UntrustedTrustSetEpoch(familyId: family, trustSetEpoch: trust, keyEpoch: key,
                entries: entries, issuedAt: date, supersedesEpoch: previous)
            try validate(epoch)
            return epoch
        }
    }

    private static func validate(_ epoch: UntrustedTrustSetEpoch) throws {
        guard opaque(epoch.familyId), (1...maximumEpoch).contains(epoch.trustSetEpoch),
              (0...maximumEpoch).contains(epoch.keyEpoch), (1...64).contains(epoch.entries.count),
              epoch.supersedesEpoch.map({ (1...maximumEpoch).contains($0) }) ?? true else { throw malformed }
        for entry in epoch.entries {
            guard [entry.deviceId, entry.dskKeyId, entry.dskPublicKey, entry.dekKeyId, entry.dekPublicKey].allSatisfy(opaque),
                  !entry.dskPublicKey.utf8.elementsEqual(entry.dekPublicKey.utf8) else { throw malformed }
        }
        try validateExactISO(epoch.issuedAt)
    }

    private static func opaque(_ value: String) -> Bool { (1...128).contains(value.utf16.count) }
    private static var malformed: TrustSetCodecError { .malformedUntrustedTrustSet }

    /// Validate scalar-by-scalar without replacement, normalization or BOM removal.
    private static func strictUTF8(_ bytes: [UInt8]) throws -> String {
        var input = bytes.makeIterator()
        var decoder = Unicode.UTF8()
        var result = ""
        while true {
            switch decoder.decode(&input) {
            case .scalarValue(let value): result.unicodeScalars.append(value)
            case .emptyInput: return result
            case .error: throw malformed
            }
        }
    }

    private static func integer(_ token: String, minimum: Int) throws -> Int {
        let bytes = Array(token.utf8)
        guard (1...10).contains(bytes.count), bytes.allSatisfy({ (48...57).contains($0) }),
              bytes.count == 1 || bytes[0] != 48, let number = Int(token),
              (minimum...maximumEpoch).contains(number) else { throw malformed }
        return number
    }

    /// Proleptic Gregorian UTC integer arithmetic, independent of locale, era and Foundation formatter limits.
    private static func validateExactISO(_ value: String) throws {
        let bytes = Array(value.utf8)
        guard bytes.count == 24 || bytes.count == 27 else { throw malformed }
        func digits(_ start: Int, _ count: Int) throws -> Int64 {
            var number: Int64 = 0
            for byte in bytes[start..<(start + count)] {
                guard (48...57).contains(byte) else { throw malformed }
                number = number * 10 + Int64(byte - 48)
            }
            return number
        }
        let offset = bytes.count == 24 ? 4 : 7
        let year: Int64
        if offset == 4 { year = try digits(0, 4) }
        else {
            guard bytes[0] == 43 || bytes[0] == 45 else { throw malformed }
            year = try digits(1, 6) * (bytes[0] == 45 ? -1 : 1)
        }
        let yearToken: String
        if (0...9999).contains(year) {
            let number = String(year); yearToken = String(repeating: "0", count: 4 - number.count) + number
        } else {
            let number = String(abs(year)); yearToken = (year < 0 ? "-" : "+") + String(repeating: "0", count: 6 - number.count) + number
        }
        guard yearToken.utf8.elementsEqual(bytes[0..<offset]), bytes[offset] == 45, bytes[offset + 3] == 45,
              bytes[offset + 6] == 84, bytes[offset + 9] == 58, bytes[offset + 12] == 58,
              bytes[offset + 15] == 46, bytes[offset + 19] == 90 else { throw malformed }
        let month = try digits(offset + 1, 2), day = try digits(offset + 4, 2)
        let hour = try digits(offset + 7, 2), minute = try digits(offset + 10, 2), second = try digits(offset + 13, 2)
        let millisecond = try digits(offset + 16, 3)
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let monthLengths: [Int64] = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...12).contains(month), (1...monthLengths[Int(month - 1)]).contains(day),
              (0...23).contains(hour), (0...59).contains(minute), (0...59).contains(second) else { throw malformed }
        func floorDivide(_ value: Int64, _ divisor: Int64) -> Int64 { value / divisor - (value % divisor < 0 ? 1 : 0) }
        let priorYear = year - 1
        let leapDays = floorDivide(priorYear, 4) - floorDivide(priorYear, 100) + floorDivide(priorYear, 400)
        let days = 365 * (year - 1970) + leapDays - 477 + monthLengths.prefix(Int(month - 1)).reduce(0, +) + day - 1
        let millis = days * 86400000 + hour * 3600000 + minute * 60000 + second * 1000 + millisecond
        guard (-8640000000000000...8640000000000000).contains(millis) else { throw malformed }
    }

    private struct WireEpoch: Decodable {
        let familyId: String, trustSetEpoch: Int, keyEpoch: Int, entries: [UntrustedTrustSetEntry]
        let issuedAt: String, supersedesEpoch: Int?, signature: String
        private enum CodingKeys: String, CodingKey { case familyId, trustSetEpoch, keyEpoch, entries, issuedAt, supersedesEpoch, signature }
        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            func number(_ key: CodingKeys, minimum: Int) throws -> Int {
                let value = try values.decode(Double.self, forKey: key)
                guard value.isFinite, value.rounded(.towardZero) == value, value >= Double(minimum), value <= Double(FamilyTrustSetCodec.maximumEpoch) else { throw FamilyTrustSetCodec.malformed }
                return Int(value)
            }
            familyId = try values.decode(String.self, forKey: .familyId)
            trustSetEpoch = try number(.trustSetEpoch, minimum: 1)
            keyEpoch = try number(.keyEpoch, minimum: 0)
            entries = try values.decode([UntrustedTrustSetEntry].self, forKey: .entries)
            issuedAt = try values.decode(String.self, forKey: .issuedAt)
            signature = try values.decode(String.self, forKey: .signature)
            guard values.contains(.supersedesEpoch) else { throw FamilyTrustSetCodec.malformed }
            if try values.decodeNil(forKey: .supersedesEpoch) { supersedesEpoch = nil }
            else { supersedesEpoch = try number(.supersedesEpoch, minimum: 1) }
        }
    }

    private static func checked<T>(_ operation: () throws -> T) throws -> T {
        do { return try operation() } catch { throw malformed }
    }
}
