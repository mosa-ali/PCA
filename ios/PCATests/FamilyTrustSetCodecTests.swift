import XCTest
import Foundation
import CryptoKit
@testable import PCA

final class FamilyTrustSetCodecTests: XCTestCase {
    private struct Corpus: Decodable {
        let version: Int
        let vectors: [Vector]
        let rejectedCanonical: [RejectedCanonical]
        let rejectedWire: [RejectedWire]
    }
    private struct Vector: Decodable { let name: String, wireJson: String, canonical: String, sha256: String }
    private struct RejectedCanonical: Decodable { let name: String; let canonical: String?; let canonicalBytesBase64: String? }
    private struct RejectedWire: Decodable { let name: String, wireJson: String }

    private func corpus() throws -> Corpus {
        let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("contracts/family-trust-set/canonical-vectors.json"))
        return try JSONDecoder().decode(Corpus.self, from: data)
    }
    private func candidate() throws -> UntrustedTrustSetEpoch {
        let fixtures = try corpus()
        let first = try XCTUnwrap(fixtures.vectors.first)
        return try FamilyTrustSetCodec.parseWire(Data(first.wireJson.utf8))
    }
    private func copy(_ value: UntrustedTrustSetEpoch, family: String? = nil, entries: [UntrustedTrustSetEntry]? = nil,
                      trust: Int? = nil, key: Int? = nil, date: String? = nil, signature: String? = nil) -> UntrustedTrustSetEpoch {
        UntrustedTrustSetEpoch(familyId: family ?? value.familyId, trustSetEpoch: trust ?? value.trustSetEpoch,
            keyEpoch: key ?? value.keyEpoch, entries: entries ?? value.entries, issuedAt: date ?? value.issuedAt,
            supersedesEpoch: value.supersedesEpoch, signature: signature ?? value.signature)
    }
    private func reject(_ operation: () throws -> Void, file: StaticString = #filePath, line: UInt = #line) {
        do { try operation(); XCTFail("Expected structural rejection", file: file, line: line) }
        catch { XCTAssertTrue(error is TrustSetCodecError, file: file, line: line) }
    }

    func testSharedBackendVectorsPinBytesHashesOrderAndFullISODateRange() throws {
        let fixtures = try corpus()
        XCTAssertEqual(fixtures.version, 1)
        for vector in fixtures.vectors {
            let value = try FamilyTrustSetCodec.parseWire(Data(vector.wireJson.utf8))
            let canonical = try FamilyTrustSetCodec.canonicalize(value)
            XCTAssertEqual(canonical, Data(vector.canonical.utf8), vector.name)
            let hash = SHA256.hash(data: canonical).map { String(format: "%02x", $0) }.joined()
            XCTAssertEqual(hash, vector.sha256, vector.name)
            let restored = try FamilyTrustSetCodec.decodeCanonical(canonical)
            XCTAssertEqual(restored.signature, "", vector.name)
            XCTAssertEqual(try FamilyTrustSetCodec.canonicalize(restored), canonical, vector.name)
            XCTAssertEqual(Data(restored.issuedAt.utf8), Data(value.issuedAt.utf8), vector.name)
        }
    }

    func testSharedMalformedCorpusRejectsOriginalWireAndCanonicalBytes() throws {
        let fixtures = try corpus()
        for vector in fixtures.rejectedCanonical {
            let bytes: Data
            if let encoded = vector.canonicalBytesBase64 { bytes = try XCTUnwrap(Data(base64Encoded: encoded)) }
            else { bytes = Data(try XCTUnwrap(vector.canonical).utf8) }
            reject { _ = try FamilyTrustSetCodec.decodeCanonical(bytes) }
        }
        for vector in fixtures.rejectedWire {
            reject { _ = try FamilyTrustSetCodec.parseWire(Data(vector.wireJson.utf8)) }
        }
    }

    func testSignatureExclusionAndMultipleOwnerCandidatesNeverGrantAcceptance() throws {
        let value = try candidate()
        let canonical = try FamilyTrustSetCodec.canonicalize(value)
        XCTAssertEqual(try FamilyTrustSetCodec.canonicalize(copy(value, signature: "different")), canonical)
        XCTAssertEqual(try FamilyTrustSetCodec.canonicalize(copy(value, signature: "")), canonical)
        let first = try XCTUnwrap(value.entries.first)
        let second = UntrustedTrustSetEntry(deviceId: "other", role: .owner, dskKeyId: "other-dsk", dskPublicKey: "other-dsk-public",
            dekKeyId: "other-dek", dekPublicKey: "other-dek-public", status: .active)
        let forward = try FamilyTrustSetCodec.canonicalize(copy(value, entries: [first, second]))
        let backward = try FamilyTrustSetCodec.canonicalize(copy(value, entries: [second, first]))
        XCTAssertNotEqual(forward, backward)
        let candidateOnly = try FamilyTrustSetCodec.decodeCanonical(forward)
        XCTAssertEqual(candidateOnly.entries.count, 2)
        XCTAssertEqual(candidateOnly.signature, "")
    }

    func testExactUnicodeIdentityDoesNotUseSwiftsNormalizedEquality() throws {
        let value = try candidate()
        let keys = UntrustedTrustSetEntry(deviceId: "😀", role: .owner, dskKeyId: "dsk", dskPublicKey: "\u{00E9}",
            dekKeyId: "dek", dekPublicKey: "e\u{0301}", status: .active)
        // Swift's String equality considers these equivalent; the signed-byte contract must not.
        XCTAssertEqual(keys.dskPublicKey, keys.dekPublicKey)
        XCTAssertNotEqual(Data(keys.dskPublicKey.utf8), Data(keys.dekPublicKey.utf8))
        let canonical = try FamilyTrustSetCodec.canonicalize(copy(value, entries: [keys]))
        let restored = try FamilyTrustSetCodec.decodeCanonical(canonical)
        XCTAssertEqual(Data(restored.entries[0].dskPublicKey.utf8), Data(keys.dskPublicKey.utf8))
        XCTAssertEqual(Data(restored.entries[0].dekPublicKey.utf8), Data(keys.dekPublicKey.utf8))
        let same = UntrustedTrustSetEntry(deviceId: keys.deviceId, role: keys.role, dskKeyId: keys.dskKeyId,
            dskPublicKey: keys.dskPublicKey, dekKeyId: keys.dekKeyId, dekPublicKey: keys.dskPublicKey, status: keys.status)
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, entries: [same])) }
        let composed = try FamilyTrustSetCodec.canonicalize(copy(value, family: "\u{00E9}"))
        let decomposed = try FamilyTrustSetCodec.canonicalize(copy(value, family: "e\u{0301}"))
        XCTAssertNotEqual(composed, decomposed)
    }

    func testUTF16LimitsAndBOMScalarsRetainExactFieldBytes() throws {
        let value = try candidate()
        let family = String(repeating: "😀", count: 64)
        let canonical = try FamilyTrustSetCodec.canonicalize(copy(value, family: family))
        XCTAssertTrue(canonical.starts(with: Data("256:".utf8)))
        XCTAssertEqual(Data(try FamilyTrustSetCodec.decodeCanonical(canonical).familyId.utf8), Data(family.utf8))
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, family: family + "a")) }
        for family in ["\u{FEFF}-family", "\u{FFFD}", "أسرة:\u{0}😀"] {
            let encoded = try FamilyTrustSetCodec.canonicalize(copy(value, family: family))
            XCTAssertEqual(Data(try FamilyTrustSetCodec.decodeCanonical(encoded).familyId.utf8), Data(family.utf8))
        }
    }

    func testMalformedUTF8FramingAndIntegerBoundsNeverReplaceOrNarrow() throws {
        let value = try candidate()
        for bytes: [UInt8] in [[0xC0, 0xAF], [0xED, 0xA0, 0x80], [0xF0, 0x9F, 0x98]] {
            reject { _ = try FamilyTrustSetCodec.decodeCanonical(Data(bytes)) }
        }
        let canonical = try FamilyTrustSetCodec.canonicalize(value)
        reject { _ = try FamilyTrustSetCodec.decodeCanonical(Data([0xEF, 0xBB, 0xBF]) + canonical) }
        reject { _ = try FamilyTrustSetCodec.decodeCanonical(canonical + Data("0:".utf8)) }
        reject { _ = try FamilyTrustSetCodec.decodeCanonical(Data("99999999999999999999:".utf8)) }
        reject { _ = try FamilyTrustSetCodec.decodeCanonical(Data(repeating: 120, count: FamilyTrustSetCodec.maximumCanonicalUTF8Bytes + 1)) }
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, trust: 0)) }
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, trust: Int(Int32.max) + 1)) }
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, key: -1)) }
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, entries: [])) }
        reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, entries: Array(repeating: value.entries[0], count: 65))) }
    }

    func testWireTypesAndExplicitNullCannotBecomeDefaults() throws {
        let first = try XCTUnwrap(try corpus().vectors.first)
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(first.wireJson.utf8)) as? [String: Any])
        for invalid: Any in [true, "1", 1.5, NSNull(), Int64(Int32.max) + 1] {
            var changed = raw; changed["trustSetEpoch"] = invalid
            let data = try JSONSerialization.data(withJSONObject: changed)
            reject { _ = try FamilyTrustSetCodec.parseWire(data) }
        }
        raw.removeValue(forKey: "supersedesEpoch")
        let missing = try JSONSerialization.data(withJSONObject: raw)
        reject { _ = try FamilyTrustSetCodec.parseWire(missing) }
        raw["supersedesEpoch"] = NSNull(); raw["signature"] = String(repeating: "s", count: 513)
        let longSignature = try JSONSerialization.data(withJSONObject: raw)
        reject { _ = try FamilyTrustSetCodec.parseWire(longSignature) }
        for number in ["1.0", "1e0"] {
            let wire = first.wireJson.replacingOccurrences(of: "\"trustSetEpoch\":1", with: "\"trustSetEpoch\":\(number)")
            XCTAssertEqual(try FamilyTrustSetCodec.parseWire(Data(wire.utf8)).trustSetEpoch, 1)
        }
    }

    func testGregorianValidityAndExactExtendedRangeBoundaries() throws {
        let value = try candidate()
        for invalid in ["2026-02-29T00:00:00.000Z", "1900-02-29T00:00:00.000Z", "2026-01-01T24:00:00.000Z",
            "2026-01-01T00:00:60.000Z", "2026-01-01T00:00:00Z", "+000001-01-01T00:00:00.000Z",
            "-000000-01-01T00:00:00.000Z", "-271821-04-19T23:59:59.999Z", "+275760-09-13T00:00:00.001Z"] {
            reject { _ = try FamilyTrustSetCodec.canonicalize(copy(value, date: invalid)) }
        }
        for valid in ["0000-02-29T00:00:00.000Z", "2000-02-29T00:00:00.000Z", "-000400-02-29T00:00:00.000Z"] {
            _ = try FamilyTrustSetCodec.canonicalize(copy(value, date: valid))
        }
    }
}
