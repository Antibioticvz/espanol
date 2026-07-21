import CoreData
import Foundation
import Observation

/// Управляет интерактивной сессией флеш-карт (v1.1, D-19): колода, показ ответа,
/// «Знал»/«Не знал», SRS с correctCount, точность, сохранение сессии.
@MainActor
@Observable
final class FlashcardViewModel {
    @ObservationIgnored let env: AppEnvironment
    @ObservationIgnored let flow: SessionFlow

    // MARK: - Observable state (зеркала колоды для SwiftUI)
    var showAnswer = false
    private(set) var currentPhraseId: String?
    private(set) var completedCount = 0
    private(set) var totalCards = 0
    private(set) var isFinished = false

    // MARK: - Internal
    @ObservationIgnored private var session = FlashcardSession(phraseIds: [])
    @ObservationIgnored private var phraseMap: [String: Phrase] = [:]
    @ObservationIgnored private var learningSession: LearningSession?
    @ObservationIgnored private var startedAt = Date()
    @ObservationIgnored private var transitions: [SpacedRepeatService.StateTransition] = []
    @ObservationIgnored private var didFinish = false

    init(env: AppEnvironment, flow: SessionFlow) {
        self.env = env
        self.flow = flow
    }

    var config: SessionConfig { flow.config }
    var direction: FlashcardDirection { config.flashcardDirection }

    // MARK: - Derived card content

    var currentPhrase: Phrase? {
        guard let id = currentPhraseId else { return nil }
        return phraseMap[id]
    }

    var questionText: String {
        guard let p = currentPhrase else { return "" }
        return direction == .esToRu ? p.textEs : p.textRu
    }
    var answerText: String {
        guard let p = currentPhrase else { return "" }
        return direction == .esToRu ? p.textRu : p.textEs
    }
    var questionLanguageLabel: String { direction == .esToRu ? "ES" : "RU" }
    var answerLanguageLabel: String { direction == .esToRu ? "RU" : "ES" }

    var progress: Double { totalCards > 0 ? Double(completedCount) / Double(totalCards) : 0 }
    var cardNumber: Int { min(completedCount + 1, totalCards) }

    // MARK: - Lifecycle

    func start() {
        let phrases = flow.orderedSelectedPhrases()
        phraseMap = Dictionary(phrases.map { ($0.phraseId, $0) }, uniquingKeysWith: { a, _ in a })
        session = FlashcardSession(phraseIds: phrases.map(\.phraseId))
        showAnswer = false
        isFinished = false
        didFinish = false
        transitions = []
        startedAt = Date()

        let ls = LearningSession(context: env.viewContext)
        ls.sessionId = UUID()
        ls.startedAt = startedAt
        ls.lesson = flow.lesson
        ls.speed = config.speed
        ls.phrasesCount = Int64(session.totalCards)
        ls.phrasesRepeats = Int64(session.totalCards)
        if let data = try? JSONEncoder().encode(config) { ls.configData = data }
        learningSession = ls
        try? env.viewContext.save()
        env.activeSessionID = ls.objectID

        env.audioSession.activate()
        syncState()
        if config.flashcardAutoplay { playQuestion() }
    }

    private func syncState() {
        currentPhraseId = session.currentId
        completedCount = session.completedCount
        totalCards = session.totalCards
    }

    // MARK: - Audio (одиночный клип, без очереди)

    private var questionLang: PhraseLanguage { direction == .esToRu ? .es : .ru }
    private var answerLang: PhraseLanguage { direction == .esToRu ? .ru : .es }

    private func url(for phrase: Phrase, lang: PhraseLanguage) -> URL? {
        (lang == .es ? phrase.audioEs : phrase.audioRu)?.fileURL
    }

    func playQuestion() {
        guard let p = currentPhrase, let u = url(for: p, lang: questionLang) else { return }
        flow.player.playClip(u, speed: config.speed, volume: env.settings.defaultVolume)
    }

    func playAnswer() {
        guard let p = currentPhrase, let u = url(for: p, lang: answerLang) else { return }
        flow.player.playClip(u, speed: config.speed, volume: env.settings.defaultVolume)
    }

    /// Кнопка озвучки: проигрывает текущую показанную сторону.
    func playCurrentSide() {
        showAnswer ? playAnswer() : playQuestion()
    }

    // MARK: - Interaction

    func reveal() {
        guard !showAnswer else { return }
        showAnswer = true
        if config.flashcardAutoplay { playAnswer() }
    }

    func markKnown() { respond(correct: true) }
    func markUnknown() { respond(correct: false) }

    private func respond(correct: Bool) {
        guard let phraseId = session.currentId else { return }
        if config.trackProgress, let phrase = phraseMap[phraseId] {
            if let transition = env.srs.registerReview(phrase, wasCorrect: correct) {
                transitions.append(transition)
            }
            try? env.viewContext.save()
        }
        if correct { session.markKnown() } else { session.markUnknown() }
        Haptics.impact(correct ? .light : .rigid, enabled: env.settings.vibrationEnabled)
        advance()
    }

    private func advance() {
        showAnswer = false
        flow.player.stopClip()
        syncState()
        if session.isFinished {
            finish()
        } else if config.flashcardAutoplay {
            playQuestion()
        }
    }

    // MARK: - Finish

    func finish() {
        guard !didFinish else { return }
        didFinish = true
        let completedAt = Date()
        let duration = Int(completedAt.timeIntervalSince(startedAt))
        flow.player.stopClip()

        if let ls = learningSession {
            ls.completedAt = completedAt
            ls.actualDurationSeconds = Int64(duration)
            ls.phrasesCompletedCount = Int64(session.completedCount)
            for transition in transitions {
                let update = PhraseStateUpdate(context: env.viewContext)
                update.phraseId = transition.phraseId
                update.oldState = transition.oldState.rawValue
                update.newState = transition.newState.rawValue
                update.updatedAt = completedAt
                update.session = ls
            }
            try? env.viewContext.save()
            if let lesson = flow.lesson {
                SessionCompletion.applyLessonProgress(
                    env: env, lesson: lesson,
                    durationSeconds: duration,
                    phrasesReviewed: session.completedCount,
                    completedAt: completedAt
                )
            }
        }

        let newAchievements = SessionCompletion.evaluateAchievements(env: env, now: completedAt)
        let recommendations = SessionCompletion.buildRecommendations(env: env)
        env.activeSessionID = nil
        env.refreshWidgetStats(now: completedAt)
        Haptics.success(enabled: env.settings.sessionCompleteVibration)

        flow.result = SessionResult(
            lessonTitle: flow.sessionTitle,
            completedAt: completedAt,
            durationSeconds: duration,
            phrasesCompleted: session.completedCount,
            phrasesTotal: session.totalCards,
            transitions: transitions,
            newAchievements: newAchievements,
            recommendations: recommendations,
            accuracy: session.accuracy
        )
        isFinished = true
        flow.step = .completed
    }

    /// Ручное завершение: если ни одной карты не закрыто — отмена (сессия не засчитывается).
    func endEarly() {
        flow.player.stopClip()
        if session.completedCount == 0 {
            abandon()
        } else {
            finish()
        }
    }

    private func abandon() {
        didFinish = true
        if let ls = learningSession {
            env.viewContext.delete(ls)
            try? env.viewContext.save()
        }
        env.activeSessionID = nil
        flow.player.reset()
        flow.reset()
        env.selectedTab = .lessons
    }
}
