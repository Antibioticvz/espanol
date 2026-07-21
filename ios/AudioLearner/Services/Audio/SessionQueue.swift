import Foundation

/// Лёгкое представление фразы для очереди воспроизведения (без зависимости от CoreData —
/// облегчает юнит-тестирование построения очереди).
struct PlayablePhrase: Equatable, Identifiable {
    let phraseId: String
    let textEs: String
    let textRu: String
    let audioEsURL: URL
    let audioRuURL: URL
    let durationEsMs: Int
    let durationRuMs: Int
    /// Множитель автоскорости по статусу (v1.2); 1.0 = без изменения.
    var speedMultiplier: Double = 1.0

    var id: String { phraseId }

    func durationSeconds(_ lang: PhraseLanguage) -> Double {
        Double(lang == .es ? durationEsMs : durationRuMs) / 1000.0
    }

    func url(_ lang: PhraseLanguage) -> URL { lang == .es ? audioEsURL : audioRuURL }
    func text(_ lang: PhraseLanguage) -> String { lang == .es ? textEs : textRu }
    func translation(_ lang: PhraseLanguage) -> String { lang == .es ? textRu : textEs }
}

extension PlayablePhrase {
    /// Строит playable из CoreData-фразы. `autoSpeedByStatus` включает множитель по статусу.
    init?(phrase: Phrase, autoSpeedByStatus: Bool = false) {
        guard let es = phrase.audioEs, let ru = phrase.audioRu else { return nil }
        self.init(
            phraseId: phrase.phraseId,
            textEs: phrase.textEs,
            textRu: phrase.textRu,
            audioEsURL: es.fileURL,
            audioRuURL: ru.fileURL,
            durationEsMs: Int(es.durationMs),
            durationRuMs: Int(ru.durationMs),
            speedMultiplier: autoSpeedByStatus ? phrase.stateEnum.autoSpeedMultiplier : 1.0
        )
    }
}

/// Ссылка на воспроизводимый аудио-элемент.
struct SessionAudioRef: Equatable {
    let phraseId: String
    let language: PhraseLanguage
    let text: String        // текст на языке аудио
    let translation: String // текст на другом языке
    let fileURL: URL
    let durationMs: Int
}

/// Элемент очереди сессии.
enum SessionQueueItem: Equatable {
    case audio(SessionAudioRef)
    case pause(TimeInterval)

    var isPause: Bool { if case .pause = self { return true }; return false }
    var phraseId: String? { if case .audio(let ref) = self { return ref.phraseId }; return nil }
    var pauseSeconds: TimeInterval? { if case .pause(let s) = self { return s }; return nil }
}

/// Построение очереди воспроизведения (спека §5, v1.2 D-23).
///
/// Каждое повторение фразы = `сторона1 → пауза → сторона2 → пауза`, где стороны и длина пауз
/// определяются `SessionConfig` (порядок сторон, фиксированная/пропорциональная пауза).
enum SessionQueueBuilder {

    private static func audioRef(_ phrase: PlayablePhrase, _ side: PhraseLanguage) -> SessionAudioRef {
        SessionAudioRef(
            phraseId: phrase.phraseId,
            language: side,
            text: phrase.text(side),
            translation: phrase.translation(side),
            fileURL: phrase.url(side),
            durationMs: side == .es ? phrase.durationEsMs : phrase.durationRuMs
        )
    }

    // MARK: - Config-driven (v1.2)

    /// Очередь для одной фразы по конфигу (порядок сторон + режим паузы).
    static func buildPhraseQueue(_ phrase: PlayablePhrase, config: SessionConfig) -> [SessionQueueItem] {
        let reps = max(1, config.repetitions)
        let sides = config.sideOrder.sides
        var items: [SessionQueueItem] = []
        items.reserveCapacity(reps * sides.count * 2)
        for _ in 0..<reps {
            for side in sides {
                items.append(.audio(audioRef(phrase, side)))
                items.append(.pause(config.pauseAfterSide(durationSeconds: phrase.durationSeconds(side))))
            }
        }
        return items
    }

    static func buildPass(phrases: [PlayablePhrase], config: SessionConfig) -> [SessionQueueItem] {
        phrases.flatMap { buildPhraseQueue($0, config: config) }
    }

    /// Полная очередь сессии с учётом режима воспроизведения.
    static func buildSession(phrases: [PlayablePhrase], config: SessionConfig) -> [SessionQueueItem] {
        let pass = buildPass(phrases: phrases, config: config)
        switch config.playbackMode {
        case .once, .loopPhrase:
            return pass
        case .cycleSession:
            return Array(repeating: pass, count: max(1, config.sessionCycles)).flatMap { $0 }
        case .flashcards:
            return [] // флеш-карты не используют аудио-очередь
        }
    }

    // MARK: - Fixed-pause convenience (ES→RU) — для простых сценариев/тестов.

    static func buildPhraseQueue(
        _ phrase: PlayablePhrase,
        repetitions: Int,
        pauseSeconds: Double
    ) -> [SessionQueueItem] {
        var config = SessionConfig.default
        config.repetitions = repetitions
        config.pauseMode = .fixed
        config.pauseSeconds = pauseSeconds
        config.sideOrder = .esRu
        return buildPhraseQueue(phrase, config: config)
    }

    static func buildPass(
        phrases: [PlayablePhrase],
        repetitions: Int,
        pauseSeconds: Double
    ) -> [SessionQueueItem] {
        phrases.flatMap { buildPhraseQueue($0, repetitions: repetitions, pauseSeconds: pauseSeconds) }
    }
}
