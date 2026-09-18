import SwiftUI

struct ContentView: View {
    @ObservedObject private var model: PCAApplicationModel

    init(model: PCAApplicationModel = PCAProductionCompositionRoot.make()) {
        self.model = model
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 16) {
                Image(systemName: "shield")
                    .font(.system(size: 42))
                    .accessibilityHidden(true)

                Text(PCALocalizedStrings.text("PCA"))
                    .font(.largeTitle.weight(.semibold))

                Text(PCALocalizedStrings.text("Native iOS foundation"))
                    .foregroundStyle(.secondary)

                Text(PCALocalizedStrings.text(AntiRemovalClaimCopy.current(for: model.authorization, protectionStatus: model.dependencies.protectionRuntime.status).statusHeadline))
                    .font(.headline)

                Text(PCALocalizedStrings.text(model.applicationState.userFacingMessage))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(PCALocalizedStrings.text(model.applicationState.userFacingMessage))

                if let disclosure = model.pendingDisclosure {
                    PCAChildEnrollmentProfileView(disclosure: disclosure) {
                        model.confirmPendingProfile()
                    }
                } else if !model.authorization.permitsEnforcement {
                    Button {
                        Task { await model.requestAuthorization() }
                    } label: {
                        Label(PCALocalizedStrings.text("Enrollment"), systemImage: "person.crop.circle.badge.checkmark")
                    }
                    .accessibilityHint(PCALocalizedStrings.text("Confirms the parent-selected settings without changing them"))
                }

                NavigationLink {
                    AboutProtectionView(authorization: model.authorization, protectionStatus: model.dependencies.protectionRuntime.status)
                } label: {
                    Label(PCALocalizedStrings.text("Removal protection"), systemImage: "lock.shield")
                }
                .padding(.top, 8)
                .accessibilityHint(PCALocalizedStrings.text("Shows what removal protection is currently active on this device and its exact scope"))
            }
            .padding()
            .accessibilityElement(children: .contain)
        }
    }
}

#Preview {
    ContentView()
}
