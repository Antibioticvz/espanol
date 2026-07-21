import SwiftUI

@main
struct AudioLearnerApp: App {
    @State private var env = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(env)
                .environment(\.managedObjectContext, env.viewContext)
                .preferredColorScheme(env.settings.theme.colorScheme)
                .dynamicTypeSize(.large)
                .task { env.onLaunch() }
                .onOpenURL { url in
                    env.pendingImportURL = url
                    env.selectedTab = .lessons
                }
        }
    }
}
