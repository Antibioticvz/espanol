import AppIntents

/// Запуск «Сессии дня» из виджета/Siri без открытия приложения (AudioPlaybackIntent, iOS 16.4+).
/// Выполняется в процессе app; через IntentActionCoordinator стартует воспроизведение.
struct StartDailySessionIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Сессия дня"
    static var description = IntentDescription("Запускает сессию дня — фразы к повтору по всем урокам.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let started = IntentActionCoordinator.shared.startDailySession()
        if started {
            return .result(dialog: "Запускаю сессию дня")
        } else {
            return .result(dialog: "Всё повторено — новых фраз к повтору сейчас нет.")
        }
    }
}

/// Пауза активной сессии (кнопка в Live Activity).
struct PauseSessionIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Пауза"

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentActionCoordinator.shared.pauseSession()
        return .result()
    }
}

/// Возобновление активной сессии (кнопка в Live Activity).
struct ResumeSessionIntent: AudioPlaybackIntent {
    static var title: LocalizedStringResource = "Продолжить"

    @MainActor
    func perform() async throws -> some IntentResult {
        IntentActionCoordinator.shared.resumeSession()
        return .result()
    }
}
