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
    /// Точность флеш-карт «с первого раза» (0…1); nil для аудио-режимов.
    var accuracy: Double?

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

    /// Кросс-урочная «Сессия дня» (D-23): lesson == nil, фразы заданы напрямую.
    var isDailySession = false
    @ObservationIgnored var dailyPhrases: [Phrase] = []

    /// Плеер живёт вместе с флоу, чтобы фон/lock screen переживали навигацию.
    @ObservationIgnored let player = SessionPlayerService()

    /// Заголовок для экрана итогов/lock screen.
    var sessionTitle: String {
        isDailySession ? "Сессия дня" : (lesson?.titleRu ?? "")
    }

    func begin(with lesson: Lesson, settings: AppSettings) {
        // Защита: любое старое воспроизведение останавливается перед новым выбором.
        player.reset()
        self.isDailySession = false
        self.dailyPhrases = []
        self.lesson = lesson
        self.lessonObjectID = lesson.topicId
        self.selectedPhraseIds = lesson.allLearnablePhrases.map(\.phraseId)
        self.config = settings.makeDefaultSessionConfig(phraseIds: selectedPhraseIds)
        self.result = nil
        self.step = .selectPhrases
    }

    /// Запускает кросс-урочную «Сессию дня» из заранее собранных фраз.
    func beginDaily(phrases: [Phrase], settings: AppSettings) {
        player.reset()
        self.isDailySession = true
        self.dailyPhrases = phrases
        self.lesson = nil
        self.lessonObjectID = nil
        self.selectedPhraseIds = phrases.map(\.phraseId)
        self.config = settings.makeDefaultSessionConfig(phraseIds: selectedPhraseIds)
        self.result = nil
        self.step = .config // выбор фраз уже сделан автоматически
    }

    func reset() {
        player.reset()
        step = .pickLesson
        lesson = nil
        lessonObjectID = nil
        selectedPhraseIds = []
        isDailySession = false
        dailyPhrases = []
        result = nil
    }

    /// Фразы для воспроизведения в порядке выбора.
    func orderedSelectedPhrases() -> [Phrase] {
        if isDailySession { return dailyPhrases }
        guard let lesson else { return [] }
        let selected = Set(selectedPhraseIds)
        return lesson.allLearnablePhrases.filter { selected.contains($0.phraseId) }
    }
}
