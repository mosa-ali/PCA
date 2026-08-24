import SwiftUI

struct ContentView: View {
    /// Snapshot-only for this home screen: real-time authorization
    /// tracking is `ChildAuthorizationCenter`'s job (see
    /// `FamilyControls/ChildAuthorizationCenter.swift`), which requires
    /// the `FamilyControls` framework at runtime. This default keeps the
    /// screen honest ("not yet active") rather than defaulting to
    /// `.approved`, consistent with doc 07 Section 14's "never silently
    /// say PROTECTED" rule; a production entry point wires the real
    /// observed state in here instead of relying on this default.
    var authorization: ChildAuthorizationState = .notDetermined

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Image(systemName: "shield")
                    .font(.system(size: 42))
                    .accessibilityHidden(true)

                Text(PCALocalizedStrings.text("PCA"))
                    .font(.largeTitle.weight(.semibold))

                Text(PCALocalizedStrings.text("Native iOS foundation"))
                    .foregroundStyle(.secondary)

                NavigationLink {
                    AboutProtectionView(authorization: authorization)
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

