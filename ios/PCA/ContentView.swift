import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: "shield")
                .font(.system(size: 42))
                .accessibilityHidden(true)

            Text("PCA")
                .font(.largeTitle.weight(.semibold))

            Text("Native iOS foundation")
                .foregroundStyle(.secondary)
        }
        .padding()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("PCA native iOS foundation")
    }
}

#Preview {
    ContentView()
}

