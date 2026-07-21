import SwiftUI

/// Корневая структура вкладок (спека §4.1).
struct ContentView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        @Bindable var env = env
        TabView(selection: $env.selectedTab) {
            LessonListView()
                .tabItem { Label("Уроки", systemImage: "books.vertical") }
                .tag(AppTab.lessons)

            SessionTabView()
                .tabItem { Label("Сессия", systemImage: "play.circle") }
                .tag(AppTab.session)

            StatisticsView()
                .tabItem { Label("Статистика", systemImage: "chart.bar") }
                .tag(AppTab.statistics)

            SettingsView()
                .tabItem { Label("Параметры", systemImage: "gear") }
                .tag(AppTab.settings)
        }
    }
}
