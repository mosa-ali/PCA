import SwiftUI

@main
struct PCAApp: App {
    @StateObject private var application: PCAApplicationModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        _application = StateObject(wrappedValue: PCAProductionCompositionRoot.make())
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
