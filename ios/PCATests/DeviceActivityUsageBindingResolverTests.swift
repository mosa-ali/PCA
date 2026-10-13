import Foundation
import XCTest
@testable import PCA

final class DeviceActivityUsageBindingResolverTests: XCTestCase {
    private struct Token: Hashable, Codable { let value: String }

    private final class Backing: OpaqueBlobStore, DeviceActivityUsageAssociationSnapshotPersistence {
        var values: [String: Data] = [:]

        func writeAtomically(_ data: Data, forKey key: String) throws { values[key] = data }
        func write(_ data: Data, forKey key: String) throws { values[key] = data }
        func read(forKey key: String) -> Data? { values[key] }
        func remove(forKey key: String) { values.removeValue(forKey: key) }
    }

    private let scope = DeviceActivityUsageAssociationScope(familyId: "family-a", deviceId: "device-a")
    private let acceptedAuthority = Data("accepted-policy-revision-7".utf8)
    private let token = Token(value: "family-controls-token")

    private func binding(_ logicalAppToken: String = "logical-app") throws -> DeviceActivityUsageSelectionBinding {
        DeviceActivityUsageSelectionBinding(logicalAppToken: logicalAppToken,
            applicationTokenData: try PropertyListEncoder().encode(token))
    }

    private func policy(dailyLimit: DailyAppLimit? = DailyAppLimit(
        appScope: .all, limitMinutes: 30, usedMinutesToday: 0, anchorLocalDate: "2026-10-09"
    )) -> DecodedSchedulePolicy {
        DecodedSchedulePolicy(activityId: "policy", appToken: "logical-app", timeZone: TimeZone(secondsFromGMT: 0)!,
            windows: [], bonusGrants: [], exceptions: [], dailyLimit: dailyLimit, enforcementCapability: .enforced)
    }

    private func installedStore() throws -> (Backing, LocalDeviceActivityPolicyCoordination, DeviceActivityUsageAssociationStore<Token>) {
        let backing = Backing()
        let coordination = LocalDeviceActivityPolicyCoordination()
        let associations = DeviceActivityUsageAssociationStore<Token>(store: backing, coordination: coordination)
        try associations.installAcceptedAssociation(scope: scope, binding: binding(), authorityBinding: acceptedAuthority,
            revision: 7, revalidateAuthority: { context in
                XCTAssertEqual(context.scope, self.scope)
                XCTAssertEqual(context.logicalAppToken, "logical-app")
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            })
        return (backing, coordination, associations)
    }

    func testAcceptedAssociationFlowsIntoDailyLimitEnforcement() throws {
        let (_, coordination, associations) = try installedStore()
        let resolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.scope, self.scope)
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
                if let revision = context.revision { XCTAssertEqual(revision, 7) }
            }
        )

        let resolved = try coordination.withExclusiveAccessContext { access in
            resolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        }
        let acceptedBinding = try XCTUnwrap(resolved)
        XCTAssertEqual(acceptedBinding, DeviceActivityUsageSelectionBinding(logicalAppToken: "logical-app",
            applicationTokenData: try binding().applicationTokenData, scope: scope))

        let now = ISO8601DateFormatter().date(from: "2026-10-09T12:00:00Z")!
        let plan = try DeviceActivityUsagePlanner.plan(policy: policy(), binding: acceptedBinding,
            generation: "22222222-2222-4222-8222-222222222222", now: now,
            deviceTimeZone: TimeZone(secondsFromGMT: 0)!, historicalActivitySupported: true, otherMonitorCount: 1)
        XCTAssertTrue(plan.matches(policy: policy()))

        let protectedFloor = Set([Token(value: "protected-floor")])
        var applied: Set<Token>?
        var removed = false
        XCTAssertTrue(try DeviceActivityUsageEnforcement.reconcile(policy: policy(), now: now,
            applications: [token], protectedApplications: protectedFloor, coverageAvailable: true,
            loadLowerBound: { plan.thresholds[0].minutes },
            apply: { applied = $0 }, remove: { removed = true }))
        XCTAssertEqual(applied, [token])
        XCTAssertFalse(removed)
        XCTAssertEqual(ScheduleEngine.evaluate(DeviceActivityUsageEvaluation.input(policy: policy(), now: now,
            lowerBoundMinutes: plan.thresholds[0].minutes, coverageAvailable: true)).kind, .blockedLimitReached)
    }

    func testDailyLimitAnchorUsesCurrentDeviceZoneAcrossDstAndTravelWhileWindowsStayAuthored() {
        let utc = TimeZone(secondsFromGMT: 0)!
        let newYork = TimeZone(identifier: "America/New_York")!
        let riyadh = TimeZone(identifier: "Asia/Riyadh")!
        let formatter = ISO8601DateFormatter()
        let now = formatter.date(from: "2026-03-09T03:30:00Z")! // 23:30 after New York's spring DST jump
        let dailyLimit = DailyAppLimit(appScope: .all, limitMinutes: 30,
            usedMinutesToday: 30, anchorLocalDate: "2026-03-08")
        let sourcePolicy = policy(dailyLimit: dailyLimit) // Policy default remains UTC.

        let newYorkInput = DeviceActivityUsageEvaluation.input(policy: sourcePolicy, now: now,
            lowerBoundMinutes: nil, deviceTimeZone: newYork, coverageAvailable: true)
        XCTAssertEqual(newYorkInput.timeZone.identifier, newYork.identifier)
        XCTAssertEqual(newYorkInput.dailyLimit?.anchorLocalDate, "2026-03-08")
        XCTAssertEqual(newYorkInput.dailyLimit?.usedMinutesToday, 30)
        XCTAssertEqual(ScheduleEngine.evaluate(newYorkInput).kind, .blockedLimitReached)

        let afterTravel = DeviceActivityUsageEvaluation.input(policy: sourcePolicy, now: now,
            lowerBoundMinutes: nil, deviceTimeZone: riyadh, coverageAvailable: true)
        XCTAssertEqual(afterTravel.dailyLimit?.anchorLocalDate, "2026-03-09")
        XCTAssertEqual(afterTravel.dailyLimit?.usedMinutesToday, 0,
            "changing device timezone changes the local usage day without mutating authenticated policy")
        XCTAssertEqual(ScheduleEngine.evaluate(afterTravel).kind, .allowed)
        XCTAssertEqual(sourcePolicy.dailyLimit?.anchorLocalDate, "2026-03-08")

        let window = ScheduleWindow(id: "authored-window", kind: .bedtime, daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
            start: TimeOfDay(hour: 22, minute: 0), end: TimeOfDay(hour: 23, minute: 59), appScope: .all,
            timeZone: newYork)
        let newYorkDecision = ScheduleEngine.evaluate(ScheduleEvaluationInput(nowUtc: now, timeZone: utc,
            appToken: "logical-app", windows: [window], bonusGrants: [], exceptions: [], dailyLimit: nil,
            enforcementCapability: .enforced))
        let riyadhDecision = ScheduleEngine.evaluate(ScheduleEvaluationInput(nowUtc: now, timeZone: riyadh,
            appToken: "logical-app", windows: [window], bonusGrants: [], exceptions: [], dailyLimit: nil,
            enforcementCapability: .enforced))
        XCTAssertEqual(newYorkDecision.kind, .blockedBedtime)
        XCTAssertEqual(riyadhDecision.kind, .blockedBedtime,
            "device timezone travel must not move a window away from its authored IANA zone")
    }

    func testAuthoredWindowUsesWallClockAtDstGapAndBothRepeatedInstants() {
        let newYork = TimeZone(identifier: "America/New_York")!
        let springWindow = ScheduleWindow(id: "spring-gap", kind: .bedtime,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay(hour: 2, minute: 30),
            end: TimeOfDay(hour: 3, minute: 30), appScope: .all, timeZone: newYork)
        let fallWindow = ScheduleWindow(id: "fall-fold", kind: .bedtime,
            daysOfWeek: [1, 2, 3, 4, 5, 6, 7], start: TimeOfDay(hour: 1, minute: 15),
            end: TimeOfDay(hour: 1, minute: 45), appScope: .all, timeZone: newYork)
        let formatter = ISO8601DateFormatter()
        func decision(_ window: ScheduleWindow, _ instant: String) -> ScheduleDecision {
            ScheduleEngine.evaluate(ScheduleEvaluationInput(
                nowUtc: formatter.date(from: instant)!, timeZone: TimeZone(identifier: "Asia/Riyadh")!,
                appToken: "logical-app", windows: [window], bonusGrants: [], exceptions: [], dailyLimit: nil,
                enforcementCapability: .enforced
            ))
        }

        XCTAssertEqual(decision(springWindow, "2026-03-08T06:59:00Z").kind, .allowed,
            "before the nonexistent 02:30 wall time, the spring window is inactive")
        XCTAssertEqual(decision(springWindow, "2026-03-08T07:00:00Z").kind, .blockedBedtime,
            "the window becomes active at the first real New York wall time inside its range")
        XCTAssertEqual(decision(springWindow, "2026-03-08T07:30:00Z").kind, .allowed)

        XCTAssertEqual(decision(fallWindow, "2026-11-01T05:30:00Z").kind, .blockedBedtime,
            "the first repeated 01:30 wall time is inside the authored window")
        XCTAssertEqual(decision(fallWindow, "2026-11-01T06:30:00Z").kind, .blockedBedtime,
            "the second repeated 01:30 wall time follows the same wall-clock policy")
        XCTAssertEqual(decision(fallWindow, "2026-11-01T06:45:00Z").kind, .allowed)
    }

    func testResolverRejectsWrongScopeSelectionAndStaleAuthority() throws {
        let (_, coordination, associations) = try installedStore()
        let wrongScopeResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: DeviceActivityUsageAssociationScope(familyId: "family-b", deviceId: "device-a"),
                authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { _ in }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            wrongScopeResolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })

        let staleAuthority = Data("accepted-policy-revision-8".utf8)
        let staleResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: staleAuthority
            ) },
            revalidateAuthority: { context in
                guard context.authorityBinding == staleAuthority else {
                    throw DeviceActivityUsageAssociationError.authorityRejected
                }
            }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            staleResolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })

        let currentResolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            }
        )
        let wrongSelection = try coordination.withExclusiveAccessContext { access in
            currentResolver.resolve(policy: policy(), selectedTokens: [Token(value: "other")], under: access)
        }
        XCTAssertNil(wrongSelection)
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            staleResolver.resolve(policy: policy(dailyLimit: nil), selectedTokens: [token], under: access)
        })
    }

    func testResolverDoesNotInferUsageBindingWhenCurrentAuthorityIsMissing() throws {
        let (_, coordination, associations) = try installedStore()
        let resolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { nil },
            revalidateAuthority: { _ in
                XCTFail("authority revalidation must not run without a current accepted authority")
            }
        )

        let resolved = try coordination.withExclusiveAccessContext { access in
            resolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        }
        XCTAssertNil(resolved, "usage cannot be attributed from a picker selection alone")
    }

    func testRevokedAssociationCannotCreateUsagePlan() throws {
        let (_, coordination, associations) = try installedStore()
        try associations.revokeAcceptedAssociation(scope: scope, logicalAppToken: "logical-app",
            authorityBinding: acceptedAuthority, revision: 8, revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            })

        let resolver = DeviceActivityUsageAssociationBindingResolver<Token>(
            associations: associations,
            coordination: coordination,
            currentAuthority: { DeviceActivityUsageAssociationAuthoritySnapshot(
                scope: self.scope, authorityBinding: self.acceptedAuthority
            ) },
            revalidateAuthority: { context in
                XCTAssertEqual(context.authorityBinding, self.acceptedAuthority)
            }
        )
        XCTAssertNil(try coordination.withExclusiveAccessContext { access in
            resolver.resolve(policy: policy(), selectedTokens: [token], under: access)
        })
    }
}
