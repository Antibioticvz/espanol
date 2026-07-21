import Foundation

/// Мост между App Intents (виджет/Siri) и приложением (v1.2, D-23).
/// Живёт в Shared (компилируется и в app, и в widget). Замыкания устанавливает приложение
/// при запуске; в процессе виджета они nil (интент AudioPlaybackIntent выполняется в процессе app).
@MainActor
final class IntentActionCoordinator {
    static let shared = IntentActionCoordinator()

    /// Стартует «Сессию дня». Возвращает false, если повторять нечего.
    var onStartDailySession: (() -> Bool)?
    /// Пауза текущей сессии (кнопка в Live Activity).
    var onPauseSession: (() -> Void)?
    /// Возобновление текущей сессии (кнопка в Live Activity).
    var onResumeSession: (() -> Void)?

    private init() {}

    @discardableResult
    func startDailySession() -> Bool { onStartDailySession?() ?? false }

    func pauseSession() { onPauseSession?() }
    func resumeSession() { onResumeSession?() }
}
