import SwiftUI

/// PCA-IOS-002 copy surface: a real screen a parent/child can reach from
/// the app's home screen, rendering `AntiRemovalClaimCopy` -- the
/// precisely-scoped anti-removal claim doc 07 Section 6 requires. This
/// is the in-app copy half of PCA-IOS-002; the marketing-copy half is
/// outside this source tree's scope (no marketing site exists here).
struct AboutProtectionView: View {
    let authorization: ChildAuthorizationState

    private var copy: AntiRemovalClaimCopy { AntiRemovalClaimCopy.current(for: authorization) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Removal protection")
                        .font(.title2.weight(.semibold))
                    Text(copy.statusHeadline)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .accessibilityElement(children: .combine)

                Text(copy.statusDetail)
                    .font(.body)
                    .fixedSize(horizontal: false, vertical: true)

                Divider()

                Text(copy.scopeQualifier)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Important scope note: \(copy.scopeQualifier)")
            }
            .padding()
        }
        .navigationTitle("Removal protection")
    }
}

#Preview {
    NavigationStack {
        AboutProtectionView(authorization: .approved)
    }
}
