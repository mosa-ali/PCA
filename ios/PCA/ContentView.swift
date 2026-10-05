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

                if model.pendingDisclosure == nil, let record = model.firstDeviceRootRecord {
                    FirstDeviceTrustRootPanel(
                        record: record,
                        readUnavailable: model.firstDeviceRootReadUnavailable,
                        coordinatorAvailable: model.dependencies.firstDeviceTrustRootCoordinator != nil,
                        isBusy: model.isFirstDeviceRootActionInProgress,
                        requestApproval: { Task { await model.requestFirstDeviceParentApproval() } },
                        checkApproval: { Task { await model.checkFirstDeviceParentApproval() } },
                        submitApprovedRoot: { Task { await model.submitApprovedFirstDeviceRoot() } },
                        retrySavedSubmission: { Task { await model.retrySavedFirstDeviceRootSubmission() } }
                    )
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

private struct FirstDeviceTrustRootPanel: View {
    let record: FirstDeviceRootRecord
    let readUnavailable: Bool
    let coordinatorAvailable: Bool
    let isBusy: Bool
    let requestApproval: () -> Void
    let checkApproval: () -> Void
    let submitApprovedRoot: () -> Void
    let retrySavedSubmission: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Divider()
            Text(PCALocalizedStrings.text("First-device security setup"))
                .font(.headline)
            if readUnavailable {
                Text(PCALocalizedStrings.text("Unable to confirm the saved secure setup state. Actions are disabled until it can be read again."))
                    .foregroundStyle(.secondary)
            } else {
                Text(PCALocalizedStrings.text(statusText))
                    .foregroundStyle(.secondary)
                    .accessibilityLabel(PCALocalizedStrings.text(statusText))
            }

            if readUnavailable {
                EmptyView()
            } else if record.state != .rootCommitted && !coordinatorAvailable {
                Text(PCALocalizedStrings.text("Secure first-device setup is unavailable on this device."))
                    .foregroundStyle(.secondary)
            } else {
                actionButtons
            }
        }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var actionButtons: some View {
        switch record.state {
        case .notStarted:
            Button(PCALocalizedStrings.text("Request parent approval"), action: requestApproval)
                .disabled(isBusy)
        case .awaitingApproval:
            Button(PCALocalizedStrings.text("Check parent approval"), action: checkApproval)
                .disabled(isBusy)
        case .approved:
            Button(PCALocalizedStrings.text("Check parent approval"), action: checkApproval)
                .disabled(isBusy)
            Button(PCALocalizedStrings.text("Submit approved secure setup"), action: submitApprovedRoot)
                .disabled(isBusy)
        case .submitting:
            Button(PCALocalizedStrings.text("Check secure setup status"), action: checkApproval)
                .disabled(isBusy)
            if record.submission != nil {
                Button(PCALocalizedStrings.text("Retry saved secure submission"), action: retrySavedSubmission)
                    .disabled(isBusy)
            }
        case .unknown:
            if record.ceremonyId == nil && record.submission == nil {
                Button(PCALocalizedStrings.text("Retry parent approval request"), action: requestApproval)
                    .disabled(isBusy)
            } else if record.ceremonyId != nil {
                Button(PCALocalizedStrings.text("Check secure setup status"), action: checkApproval)
                    .disabled(isBusy)
                if record.submission != nil {
                    Button(PCALocalizedStrings.text("Retry saved secure submission"), action: retrySavedSubmission)
                        .disabled(isBusy)
                }
            }
        case .expired:
            Button(PCALocalizedStrings.text("Request parent approval again"), action: requestApproval)
                .disabled(isBusy)
        case .rootCommitted, .rejected:
            EmptyView()
        }
    }

    private var statusText: String {
        switch record.state {
        case .notStarted:
            return "Parent approval has not been requested."
        case .awaitingApproval:
            return "Waiting for parent approval."
        case .approved:
            return "Parent approved this request. Submit it to ask the server to accept the family root."
        case .submitting:
            return "The secure setup submission is in progress or needs status confirmation."
        case .unknown:
            return "The secure setup result could not be confirmed. Check status or retry the saved submission."
        case .rootCommitted:
            return "The server accepted the family root. Device activation and protection are separate steps."
        case .expired:
            return "The parent approval request expired."
        case .rejected:
            return "The server did not accept this secure setup request. It cannot be reused."
        }
    }
}

#Preview {
    ContentView()
}
