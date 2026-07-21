import Foundation
import Observation

/// Результат завершённой сессии для экрана итогов (спека §4.7).
struct SessionResult {
    var lessonTitle: String
    var completedAt: Date
    var durationSeconds: Int
    var phrasesCompleted: Int
    var phrasesTotal: Int
    var transitions: [SpacedRepeatService.StateTransition]
    var newAchievements: [Achievement]
    var recommendations: [String]

    var averageSecondsPerPhrase: Int {
        phrasesCompleted > 0 ? durationSeconds / phrasesCompleted : 0
    }
}

/// Координатор флоу сессии: выбор фраз → настройки → плеер → итоги (спека §4.4–4.7).
@MainActor
@Observable
final class SessionFlow {
    enum Step: Hashable {
        case pickLesson
        case selectPhrases
        case config
        case player
        case completed
    }

    var step: Step = .pickLesson
    @ObservationIgnored var lesson: Lesson?
    var lessonObjectID: String?
    var selectedPhraseIds: [String] = []
    var config: SessionConfig = .default
    var result: SessionResult?

    /// Плеер живёт вместе с флоу, чтобы фон/lock screen переживали навигацию.
    @ObservationIgnored let player = SessionPlayerService()

    func begin(with lesson: Lesson, settings: AppSettings) {
        // Защита: любое старое воспроизведение останавливается перед новым выбором.
        player.reset()
        self.lesson = lesson
        self.lessonObjectID = lesson.topicId
        self.selectedPhraseIds = lesson.allLearnablePhrases.map(\.phraseId)
        self.config = settings.makeDefaultSessionConfig(phraseIds: selectedPhraseIds)
        self.result = nil
        self.step = .selectPhrases
    }

    func reset() {
        player.reset()
        step = .pickLesson
        lesson = nil
        lessonObjectID = nil
        selectedPhraseIds = []
        result = nil
    }

    /// Фразы урока в порядке урока, отфильтрованные по выбранным id.
    func orderedSelectedPhrases() -> [Phrase] {
        guard let lesson else { return [] }
        let selected = Set(selectedPhraseIds)
        return lesson.allLearnablePhrases.filter { selected.contains($0.phraseId) }
    }
}
