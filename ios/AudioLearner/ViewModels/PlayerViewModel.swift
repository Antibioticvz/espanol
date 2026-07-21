import CoreData
import Foundation
import Observation

/// Управляет жизненным циклом воспроизводимой сессии: очередь, SRS, lock screen, сохранение.
@Observable
final class PlayerViewModel {
    @ObservationIgnored let env: AppEnvironment
    @ObservationIgnored let flow: SessionFlow
    @ObservationIgnored private let lockScreen = LockScreenService()

    var player: SessionPlayerService { flow.player }
    var showParameters = false

    @ObservationIgnored private var learningSession: LearningSession?
    @ObservationIgnored private var startedAt = Date()
    @ObservationIgnored private var transitions: [SpacedRepeatService.StateTransition] = []
    @ObservationIgnored private var didFinish = false

    init(env: AppEnvironment, flow: SessionFlow) {
        self.env = env
        self.flow = flow
    }

    // MARK: - Start

    func startSession() {
        guard let lesson = flow.lesson else { return }
        let phrases = flow.orderedSelectedPhrases()
        let playables = phrases.compactMap { PlayablePhrase(phrase: $0) }

        startedAt = Date()
        transitions = []
        didFinish = false

        // Создаём запись сессии.
        let session = LearningSession(context: env.viewContext)
        session.sessionId = UUID()
        session.startedAt = startedAt
        session.lesson = lesson
        session.speed = flow.config.speed
        session.phrasesCount = Int64(playables.count)
        session.phrasesRepeats = Int64(playables.count * flow.config.repetitions)
        if let data = try? JSONEncoder().encode(flow.config) {
            session.configData = data
        }
        learningSession = session
        try? env.viewContext.save()

        // Настраиваем аудио-сессию и lock screen.
        env.audioSession.activate()
        env.audioSession.onInterruptionBegan = { [weak self] in self?.player.pause() }
        env.audioSession.onInterruptionEnded = { [weak self] resume in if resume { self?.player.play() } }
        env.audioSession.onRouteChangeShouldPause = { [weak self] in self?.player.pause() }

        lockScreen.setupRemoteCommands()
        lockScreen.onPlay = { [weak self] in self?.player.play(); self?.updateNowPlaying() }
        lockScreen.onPause = { [weak self] in self?.player.pause(); self?.updateNowPlaying() }
        lockScreen.onNext = { [weak self] in self?.next() }
        lockScreen.onPrevious = { [weak self] in self?.previous() }

        // Колбэки плеера.
        player.onPhraseCompleted = { [weak self] phraseId in self?.handlePhraseCompleted(phraseId) }
        player.onSessionFinished = { [weak self] in self?.finish() }
        player.onItemChanged = { [weak self] in self?.updateNowPlaying() }

        player.configure(phrases: playables, config: flow.config)
        player.start()
        updateNowPlaying()
    }

    // MARK: - Controls

    func togglePlayPause() {
        player.togglePlayPause()
        Haptics.impact(.light, enabled: env.settings.vibrationEnabled)
        updateNowPlaying()
    }

    func next() {
        player.nextPhrase()
        updateNowPlaying()
    }

    func previous() {
        player.previousPhrase()
        updateNowPlaying()
    }

    func repeatPhrase() {
        player.repeatCurrentPhrase()
        updateNowPlaying()
    }

    func setSpeed(_ speed: Double) {
        player.speed = speed
        updateNowPlaying()
    }

    func toggleFavorite() {
        guard let phraseId = player.currentPhrase?.phraseId,
              let phrase = try? env.repository.phrase(phraseId: phraseId) else { return }
        phrase.isFavorite.toggle()
        try? env.viewContext.save()
    }

    var isCurrentFavorite: Bool {
        guard let phraseId = player.currentPhrase?.phraseId,
              let phrase = try? env.repository.phrase(phraseId: phraseId) else { return false }
        return phrase.isFavorite
    }

    // MARK: - SRS

    private func handlePhraseCompleted(_ phraseId: String) {
        guard flow.config.trackProgress else { return }
        guard let phrase = try? env.repository.phrase(phraseId: phraseId) else { return }
        if let transition = env.srs.registerReview(phrase) {
            transitions.append(transition)
        }
        try? env.viewContext.save()
    }

    // MARK: - Finish

    func finish() {
        guard !didFinish else { return }
        didFinish = true
        let completedAt = Date()
        let duration = Int(completedAt.timeIntervalSince(startedAt))

        if let session = learningSession, let lesson = flow.lesson {
            session.completedAt = completedAt
            session.actualDurationSeconds = Int64(duration)
            session.phrasesCompletedCount = Int64(player.completedPhraseIds.count)

            // Записи об изменениях состояния.
            for transition in transitions {
                let update = PhraseStateUpdate(context: env.viewContext)
                update.phraseId = transition.phraseId
                update.oldState = transition.oldState.rawValue
                update.newState = transition.newState.rawValue
                update.updatedAt = completedAt
                update.session = session
            }

            // Обновляем прогресс урока.
            let progress = lesson.progress ?? LessonProgress(context: env.viewContext)
            progress.lesson = lesson
            env.repository.recomputeProgressCounters(progress, lesson: lesson)
            progress.totalSessionsCompleted += 1
            progress.totalMinutesLearned += Int64(duration / 60)
            progress.totalPhrasesReviewed += Int64(player.completedPhraseIds.count)
            progress.lastCompletedSessionAt = completedAt
            progress.lastAccessedAt = completedAt

            try? env.viewContext.save()

            // Streak в прогрессе урока.
            let allSessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
            let currentStreak = env.statistics.currentStreak(sessions: allSessions, now: completedAt)
            progress.streakDays = Int64(currentStreak)
            progress.bestStreakDays = max(progress.bestStreakDays, Int64(currentStreak))
            try? env.viewContext.save()
        }

        // Достижения.
        let newAchievements = evaluateAchievements(now: completedAt)
        // Рекомендации по повтору.
        let recommendations = buildRecommendations()

        lockScreen.clear()
        env.refreshWidgetStats(now: completedAt)
        Haptics.success(enabled: env.settings.sessionCompleteVibration)

        flow.result = SessionResult(
            lessonTitle: flow.lesson?.titleRu ?? "",
            completedAt: completedAt,
            durationSeconds: duration,
            phrasesCompleted: player.completedPhraseIds.count,
            phrasesTotal: player.totalPhrases,
            transitions: transitions,
            newAchievements: newAchievements,
            recommendations: recommendations
        )
        flow.step = .completed
    }

    /// Пользователь завершил сессию вручную.
    func endEarly() {
        player.pause()
        finish()
    }

    private func evaluateAchievements(now: Date) -> [Achievement] {
        let sessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
        let completed = sessions.filter { $0.completedAt != nil }
        let atMaxSpeed = completed.filter { $0.speed >= 2.0 }.count
        let nightCount = completed.filter { session in
            guard let done = session.completedAt else { return false }
            let hour = Calendar.current.component(.hour, from: done)
            return hour >= 22 || hour < 4
        }.count
        let lessons = (try? env.repository.allLessons()) ?? []
        let anyMastered = lessons.contains { lesson in
            let total = lesson.allLearnablePhrases.count
            return total > 0 && lesson.allLearnablePhrases.allSatisfy { $0.stateEnum == .mastered }
        }
        let context = AchievementContext(
            completedSessions: completed.count,
            currentStreak: env.statistics.currentStreak(sessions: sessions, now: now),
            sessionsAtMaxSpeed: atMaxSpeed,
            nightSessions: nightCount,
            anyLessonFullyMastered: anyMastered
        )
        return env.achievements.evaluate(context: context)
    }

    private func buildRecommendations() -> [String] {
        let lessons = (try? env.repository.allLessons()) ?? []
        var result: [String] = []
        for lesson in lessons {
            let due = env.srs.recommendedPhrases(in: lesson).count
            if due > 0 {
                result.append("Повторите «\(lesson.titleRu)» — \(Format.phraseCount(due)) к повтору")
            }
        }
        return Array(result.prefix(3))
    }

    // MARK: - Now Playing

    func updateNowPlaying() {
        guard let phrase = player.currentPhrase else { return }
        lockScreen.update(
            textEs: phrase.textEs,
            textRu: phrase.textRu,
            lessonTitle: flow.lesson?.titleRu ?? "",
            duration: player.currentDuration,
            elapsed: player.currentTime,
            rate: player.isPlaying ? player.speed : 0,
            trackNumber: player.currentPhraseIndex + 1,
            trackCount: player.totalPhrases,
            textMode: flow.config.lockScreenTextMode
        )
    }
}
