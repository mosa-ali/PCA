import XCTest
@testable import PCA

/// WAVE 6D regression coverage: the strict DER -> IEEE-P1363 low-S converter.
/// The DER fixtures and their expected 64-byte P1363 outputs were generated
/// independently (BigInt arithmetic, `.agent-local-artifacts/wave6d/`)
/// so this suite pins the Swift byte-walk parser against a second
/// implementation, including both low-S boundaries and the complete
/// rejection matrix.
final class P256DerSignatureTests: XCTestCase {
    private struct Fixture {
        let name: String
        let derHex: String
        let expectedP1363Hex: String?
    }

    private let acceptFixtures: [Fixture] = [
        Fixture(
            name: "minimal one-byte scalars",
            derHex: "3006020101020101",
            expectedP1363Hex: "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"
        ),
        Fixture(
            name: "max scalars n-1 normalize s",
            derHex: "3046022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632550",
            expectedP1363Hex: "ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc6325500000000000000000000000000000000000000000000000000000000000000001"
        ),
        Fixture(
            name: "boundary s = half kept",
            derHex: "302502010102207fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8",
            expectedP1363Hex: "00000000000000000000000000000000000000000000000000000000000000017fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8"
        ),
        Fixture(
            name: "boundary s = half+1 normalizes to half",
            derHex: "302502010102207fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a9",
            expectedP1363Hex: "00000000000000000000000000000000000000000000000000000000000000017fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8"
        ),
        Fixture(
            name: "r with high bit set keeps 32-byte fixed width",
            derHex: "301602110080000000000000000000000000000000020101",
            expectedP1363Hex: "00000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001"
        ),
        Fixture(
            name: "r = half kept",
            derHex: "304402207fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a802207fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8",
            expectedP1363Hex: "7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a87fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8"
        ),
        Fixture(
            name: "long-form sequence length accepted",
            derHex: "308106020101020101",
            expectedP1363Hex: "00000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001"
        ),
    ]

    private let rejectFixtures: [Fixture] = [
        Fixture(name: "r = zero", derHex: "3006020100020101", expectedP1363Hex: nil),
        Fixture(name: "s = zero", derHex: "3006020101020100", expectedP1363Hex: nil),
        Fixture(name: "s = n rejected", derHex: "3026020101022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551", expectedP1363Hex: nil),
        Fixture(name: "r = n rejected", derHex: "3026022100ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551020101", expectedP1363Hex: nil),
        Fixture(name: "trailing byte after sequence", derHex: "300602010102010100", expectedP1363Hex: nil),
        Fixture(name: "negative integer", derHex: "3006020181020101", expectedP1363Hex: nil),
        Fixture(name: "wrong sequence tag", derHex: "3106020101020101", expectedP1363Hex: nil),
        Fixture(name: "truncated integer content", derHex: "300402030101", expectedP1363Hex: nil),
        Fixture(name: "indefinite length", derHex: "30800201010201010000", expectedP1363Hex: nil),
        Fixture(name: "unsupported long-form count", derHex: "30850102030405020101020101", expectedP1363Hex: nil),
        Fixture(name: "integer length 34 rejected", derHex: "3027022211111111111111111111111111111111111111111111111111111111111111111111020101", expectedP1363Hex: nil),
        Fixture(name: "sequence length mismatch", derHex: "3005020101020101", expectedP1363Hex: nil),
        Fixture(name: "empty integer", derHex: "30050200020101", expectedP1363Hex: nil),
        Fixture(name: "third integer leaves trailing content", derHex: "3009020101020101020101", expectedP1363Hex: nil),
        Fixture(name: "empty input", derHex: "", expectedP1363Hex: nil),
        Fixture(name: "sequence header only", derHex: "3006", expectedP1363Hex: nil),
    ]

    private func bytes(_ hex: String) -> Data {
        var data = Data()
        var index = hex.startIndex
        while index < hex.endIndex {
            let next = hex.index(index, offsetBy: 2)
            data.append(UInt8(hex[index..<next], radix: 16) ?? 0)
            index = next
        }
        return data
    }

    private func hexString(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    func testHalfOrderSatisfiesOrderIdentity() {
        let order = [UInt8](P256DerSignature.order)
        let half = [UInt8](P256DerSignature.halfOrder)
        XCTAssertEqual(order.count, 32)
        XCTAssertEqual(half.count, 32)
        // n = 2 * floor(n/2) + 1 -- independently recomputed here so a
        // corrupted embedded constant cannot pass.
        XCTAssertEqual(addOne(doubled(half)), order)
    }

    func testAcceptedDerFixturesConvertByteExact() throws {
        for fixture in acceptFixtures {
            let p1363 = try P256DerSignature.toLowSIeeeP1363(der: bytes(fixture.derHex))
            XCTAssertEqual(p1363.count, 64, fixture.name)
            XCTAssertEqual(hexString(p1363), fixture.expectedP1363Hex, fixture.name)
            XCTAssertTrue(P256DerSignature.isLowS(p1363), fixture.name)
        }
    }

    func testRejectedDerFixturesThrowMalformedDer() {
        for fixture in rejectFixtures {
            XCTAssertThrowsError(try P256DerSignature.toLowSIeeeP1363(der: bytes(fixture.derHex)), fixture.name) { error in
                XCTAssertEqual(error as? P256DerSignatureError, .malformedDer, fixture.name)
            }
        }
    }

    func testIsLowSRejectsHighHalfPlusOne() {
        let highS = bytes("7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a9")
        XCTAssertEqual(highS.count, 32)
        let p1363 = bytes("0000000000000000000000000000000000000000000000000000000000000001") + highS
        XCTAssertFalse(P256DerSignature.isLowS(p1363))
        XCTAssertFalse(P256DerSignature.isLowS(Data(repeating: 0, count: 63)))
    }

    // MARK: - Local big-endian helpers (independent of the production code)

    private func doubled(_ value: [UInt8]) -> [UInt8] {
        var result = value
        var carry = 0
        for index in stride(from: value.count - 1, through: 0, by: -1) {
            let shifted = (Int(value[index]) << 1) | carry
            result[index] = UInt8(shifted & 0xFF)
            carry = shifted >> 8
        }
        return result
    }

    private func addOne(_ value: [UInt8]) -> [UInt8] {
        var result = value
        for index in stride(from: value.count - 1, through: 0, by: -1) {
            if result[index] < 0xFF {
                result[index] += 1
                return result
            }
            result[index] = 0
        }
        return result
    }
}
