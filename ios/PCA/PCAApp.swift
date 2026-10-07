import SwiftUI
import UIKit
import BackgroundTasks

@MainActor enum PCAHostRuntime {
    static let application = PCAProductionCompositionRoot.make()
    static let refresh = PCARuntimeRefreshScheduler()
}

/// One latch owns only the background campaign, never a foreground task.
final class PCARefreshCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private let complete: (Bool) -> Void
    private var ownedTask: Task<Void, Never>?
    private var completed = false
    private var expired = false
    init(complete: @escaping (Bool) -> Void) { self.complete = complete }
    convenience init(_ task: BGTask) { self.init(complete: { task.setTaskCompleted(success: $0) }) }
    func attach(_ task: Task<Void, Never>) {
        lock.lock()
        let cancel = expired
        if !completed { ownedTask = task }
        lock.unlock()
        if cancel { task.cancel() }
    }
    func expire() {
        lock.lock()
        expired = true
        let task = ownedTask
        lock.unlock()
        task?.cancel()
        finish(success: false)
    }
    func finish(success: Bool) {
        lock.lock()
        guard !completed else { lock.unlock(); return }
        completed = true
        ownedTask = nil
        let accepted = success && !expired
        lock.unlock()
        complete(accepted)
    }
}

@MainActor final class PCARuntimeRefreshScheduler {
    static let identifier = "org.pca.app.runtime-sync.refresh"
    private(set) var registrationFailed = false
    private(set) var submissionFailed = false
    private var registered = false

    func register() {
        guard !registered else { return }
        registered = BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.identifier, using: nil) { task in
            let completion = PCARefreshCompletion(task)
            task.expirationHandler = { completion.expire() }
            guard task is BGAppRefreshTask else { completion.finish(success: false); return }
            let owned = Task { @MainActor in
                defer { PCAHostRuntime.refresh.schedule() }
                do {
                    try Task.checkCancellation()
                    let outcome = try await PCAHostRuntime.application.synchronizeRuntimeCampaign()
                    try Task.checkCancellation()
                    switch outcome {
                    case .complete, .ineligible: completion.finish(success: true)
                    case .morePending, .retryableFailure, .blocked: completion.finish(success: false)
                    }
                } catch { completion.finish(success: false) }
            }
            completion.attach(owned)
        }
        registrationFailed = !registered
        if registered { schedule() }
    }

    func schedule() {
        guard registered else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.identifier)
        // Best effort only: iOS decides whether and when to launch the task.
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        do { try BGTaskScheduler.shared.submit(request); submissionFailed = false }
        catch { submissionFailed = true }
    }
}

@MainActor final class PCAApplicationDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        PCAHostRuntime.refresh.register()
        return true
    }
}

@main
@MainActor struct PCAApp: App {
    @UIApplicationDelegateAdaptor(PCAApplicationDelegate.self) private var appDelegate
    @StateObject private var application: PCAApplicationModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        _application = StateObject(wrappedValue: PCAHostRuntime.application)
    }

    var body: some Scene {
        WindowGroup {
            ContentView(model: application)
                .onAppear { application.start() }
                .onOpenURL { url in _ = application.receiveEnrollmentLink(url) }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { application.sceneBecameActive() }
                }
        }
    }
}
