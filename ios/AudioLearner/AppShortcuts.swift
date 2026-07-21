import AppIntents

/// Siri / App Shortcuts: «Запусти испанский» / «Сессия дня» → StartDailySessionIntent (D-23).
struct AudioLearnerShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartDailySessionIntent(),
            phrases: [
                "Запусти испанский в \(.applicationName)",
                "Сессия дня в \(.applicationName)",
                "Начни сессию дня в \(.applicationName)"
            ],
            shortTitle: "Сессия дня",
            systemImageName: "sparkles"
        )
    }
}
