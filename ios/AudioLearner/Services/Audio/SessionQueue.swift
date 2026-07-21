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

    var id: String { phraseId }
}

extension PlayablePhrase {
    /// Строит playable из CoreData-фразы (использует относительные пути аудио).
    init?(phrase: Phrase) {
        guard let es = phrase.audioEs, let ru = phrase.audioRu else { return nil }
        self.init(
            phraseId: phrase.phraseId,
            textEs: phrase.textEs,
            textRu: phrase.textRu,
            audioEsURL: es.fileURL,
            audioRuURL: ru.fileURL,
            durationEsMs: Int(es.durationMs),
            durationRuMs: Int(ru.durationMs)
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
}

/// Построение очереди воспроизведения (спека §5).
///
/// Контракт (см. задание): каждое повторение фразы = `ES → пауза → RU → пауза`.
/// Для N повторений одной фразы получается 4·N элементов.
enum SessionQueueBuilder {

    /// Очередь для одной фразы: N раз [ES, пауза, RU, пауза].
    static func buildPhraseQueue(
        _ phrase: PlayablePhrase,
        repetitions: Int,
        pauseSeconds: Double
    ) -> [SessionQueueItem] {
        let reps = max(1, repetitions)
        let esRef = SessionAudioRef(
            phraseId: phrase.phraseId, language: .es,
            text: phrase.textEs, translation: phrase.textRu,
            fileURL: phrase.audioEsURL, durationMs: phrase.durationEsMs
        )
        let ruRef = SessionAudioRef(
            phraseId: phrase.phraseId, language: .ru,
            text: phrase.textRu, translation: phrase.textEs,
            fileURL: phrase.audioRuURL, durationMs: phrase.durationRuMs
        )
        var items: [SessionQueueItem] = []
        items.reserveCapacity(reps * 4)
        for _ in 0..<reps {
            items.append(.audio(esRef))
            items.append(.pause(pauseSeconds))
            items.append(.audio(ruRef))
            items.append(.pause(pauseSeconds))
        }
        return items
    }

    /// Один проход по всем фразам (режим «Один раз»).
    static func buildPass(
        phrases: [PlayablePhrase],
        repetitions: Int,
        pauseSeconds: Double
    ) -> [SessionQueueItem] {
        phrases.flatMap {
            buildPhraseQueue($0, repetitions: repetitions, pauseSeconds: pauseSeconds)
        }
    }

    /// Полная очередь сессии с учётом режима воспроизведения.
    /// - `once` / `loopPhrase`: один проход (loopPhrase зацикливается интерактивно плеером).
    /// - `cycleSession`: `sessionCycles` проходов подряд.
    static func buildSession(
        phrases: [PlayablePhrase],
        config: SessionConfig
    ) -> [SessionQueueItem] {
        let pass = buildPass(
            phrases: phrases,
            repetitions: config.repetitions,
            pauseSeconds: config.pauseSeconds
        )
        switch config.playbackMode {
        case .once, .loopPhrase:
            return pass
        case .cycleSession:
            let cycles = max(1, config.sessionCycles)
            return Array(repeating: pass, count: cycles).flatMap { $0 }
        case .flashcards:
            return [] // флеш-карты не используют аудио-очередь
        }
    }
}
