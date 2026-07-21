import Foundation

/// Конфигурация сессии обучения (экран SessionConfigView, спека §4.5).
/// Сохраняется в `LearningSession.configData` как JSON.
struct SessionConfig: Codable, Equatable {
    /// Идентификаторы выбранных фраз (phraseId).
    var phraseIds: [String]
    /// Количество повторений каждой фразы (1–10).
    var repetitions: Int
    /// Скорость воспроизведения (0.5–2.0), без изменения питча.
    var speed: Double
    /// Пауза между элементами очереди, сек (0–15).
    var pauseSeconds: Double
    /// Режим воспроизведения.
    var playbackMode: PlaybackMode
    /// Число циклов для режима cycleSession.
    var sessionCycles: Int
    /// Режим показа текста на lock screen.
    var lockScreenTextMode: LockScreenTextMode
    /// Обновлять ли state фраз во время воспроизведения.
    var trackProgress: Bool
    /// Флеш-карты: направление вопрос→ответ.
    var flashcardDirection: FlashcardDirection
    /// Флеш-карты: автопроигрывание аудио при показе стороны карточки.
    var flashcardAutoplay: Bool

    static let allowedSpeeds: [Double] = [0.5, 0.75, 1.0, 1.5, 2.0]

    /// Режим флеш-карт активен.
    var isFlashcards: Bool { playbackMode == .flashcards }

    static let `default` = SessionConfig(
        phraseIds: [],
        repetitions: 5,
        speed: 1.0,
        pauseSeconds: 3,
        playbackMode: .once,
        sessionCycles: 2,
        lockScreenTextMode: .both,
        trackProgress: true,
        flashcardDirection: .esToRu,
        flashcardAutoplay: true
    )

    /// Оценка длительности сессии по фактическим длительностям аудио (сек).
    /// - Parameter phraseDurations: (es, ru) длительности в секундах для каждой выбранной фразы.
    func estimatedDuration(phraseDurations: [(es: Double, ru: Double)]) -> TimeInterval {
        let audioPerRepeat = phraseDurations.reduce(0.0) { $0 + ($1.es + $1.ru) / speed }
        // Каждое повторение = ES, пауза, RU, пауза → 2 паузы на повтор на фразу.
        let pausesPerRepeat = Double(phraseDurations.count) * pauseSeconds * 2
        let perPass = audioPerRepeat + pausesPerRepeat
        let passTotal = perPass * Double(repetitions)
        let cycles = playbackMode == .cycleSession ? Double(max(1, sessionCycles)) : 1
        return passTotal * cycles
    }
}
