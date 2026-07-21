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
    /// Пауза между элементами очереди, сек (0–15) — для фиксированного режима.
    var pauseSeconds: Double
    /// Способ задания паузы: фиксированная или пропорциональная длине стороны (v1.2).
    var pauseMode: PauseMode
    /// Коэффициент пропорциональной паузы (1.0–2.5), пауза = длина стороны × коэффициент.
    var pauseCoefficient: Double
    /// Порядок сторон: ES→RU / RU→ES / ES→ES (v1.2).
    var sideOrder: SideOrder
    /// Автоскорость по статусу фразы (множитель поверх скорости сессии, v1.2).
    var autoSpeedByStatus: Bool
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

    static let allowedPauseCoefficients: [Double] = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5]

    static let `default` = SessionConfig(
        phraseIds: [],
        repetitions: 5,
        speed: 1.0,
        pauseSeconds: 3,
        pauseMode: .proportional,
        pauseCoefficient: 1.5,
        sideOrder: .esRu,
        autoSpeedByStatus: false,
        playbackMode: .once,
        sessionCycles: 2,
        lockScreenTextMode: .both,
        trackProgress: true,
        flashcardDirection: .esToRu,
        flashcardAutoplay: true
    )

    /// Пауза после стороны заданной длины (сек) по текущему режиму.
    func pauseAfterSide(durationSeconds: Double) -> TimeInterval {
        switch pauseMode {
        case .fixed: return pauseSeconds
        case .proportional: return durationSeconds * pauseCoefficient
        }
    }

    /// Оценка длительности сессии по фактическим длительностям аудио (сек).
    /// Учитывает порядок сторон и режим паузы (авто-скорость по статусу — приблизительно, без учёта).
    func estimatedDuration(phraseDurations: [(es: Double, ru: Double)]) -> TimeInterval {
        let sides = sideOrder.sides
        var total = 0.0
        for d in phraseDurations {
            var perRep = 0.0
            for side in sides {
                let sideDur = side == .es ? d.es : d.ru
                perRep += sideDur / speed
                perRep += pauseAfterSide(durationSeconds: sideDur)
            }
            total += perRep * Double(repetitions)
        }
        let cycles = playbackMode == .cycleSession ? Double(max(1, sessionCycles)) : 1
        return total * cycles
    }
}
