import CoreData
import Foundation
import Observation

/// Управляет жизненным циклом воспроизводимой сессии: очередь, SRS, lock screen, сохранение.
@MainActor
@Observable
final class PlayerViewModel {
    @ObservationIgnored let env: AppEnvironment
    @ObservationIgnored let flow: SessionFlow

    var player: SessionPlayerService { flow.player }
    var showParameters = false
    /// Наблюдаемое зеркало избранного текущей фразы (CoreData-атрибут @Observable не отслеживает).
    private(set) var isCurrentFavorite = false

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
        let phrases = flow.orderedSelectedPhrases()
        guard !phrases.isEmpty else { return }
        let playables = phrases.compactMap {
            PlayablePhrase(phrase: $0, autoSpeedByStatus: flow.config.autoSpeedByStatus)
        }

        startedAt = Date()
        transitions = []
        didFinish = false

        // Создаём запись сессии (lesson == nil для «Сессии дня», D-17 это позволяет).
        let session = LearningSession(context: env.viewContext)
        session.sessionId = UUID()
        session.startedAt = startedAt
        session.lesson = flow.lesson
        session.speed = flow.config.speed
        session.phrasesCount = Int64(playables.count)
        session.phrasesRepeats = Int64(playables.count * flow.config.repetitions)
        if let data = try? JSONEncoder().encode(flow.config) {
            session.configData = data
        }
        learningSession = session
        try? env.viewContext.save()
        env.activeSessionID = session.objectID

        // Настраиваем аудио-сессию и lock screen. Колбэки могут приходить не с main —
        // возвращаемся на главный актор перед обращением к плееру.
        env.audioSession.activate()
        env.audioSession.onInterruptionBegan = { [weak self] in
            Task { @MainActor in self?.player.pause(); self?.updateNowPlaying() }
        }
        env.audioSession.onInterruptionEnded = { [weak self] resume in
            Task { @MainActor in if resume { self?.player.play(); self?.updateNowPlaying() } }
        }
        env.audioSession.onRouteChangeShouldPause = { [weak self] in
            Task { @MainActor in self?.player.pause(); self?.updateNowPlaying() }
        }

        env.lockScreen.setupRemoteCommands()
        env.lockScreen.onPlay = { [weak self] in Task { @MainActor in self?.player.play(); self?.updateNowPlaying() } }
        env.lockScreen.onPause = { [weak self] in Task { @MainActor in self?.player.pause(); self?.updateNowPlaying() } }
        env.lockScreen.onToggle = { [weak self] in Task { @MainActor in self?.player.togglePlayPause(); self?.updateNowPlaying() } }
        env.lockScreen.onNext = { [weak self] in Task { @MainActor in self?.next() } }
        env.lockScreen.onPrevious = { [weak self] in Task { @MainActor in self?.previous() } }

        // Колбэки плеера.
        player.onPhraseCompleted = { [weak self] phraseId in self?.handlePhraseCompleted(phraseId) }
        player.onSessionFinished = { [weak self] in self?.finish() }
        player.onItemChanged = { [weak self] in self?.updateNowPlaying() }
        player.onSleepTimerFired = { [weak self] in
            Haptics.success(enabled: self?.env.settings.vibrationEnabled ?? true)
            self?.updateNowPlaying()
        }

        player.configure(phrases: playables, config: flow.config)
        player.volume = env.settings.defaultVolume
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

    func setSleepTimer(minutes: Int) {
        player.setSleepTimer(minutes: minutes)
    }

    func toggleFavorite() {
        guard let phraseId = player.currentPhrase?.phraseId,
              let phrase = try? env.repository.phrase(phraseId: phraseId) else { return }
        phrase.isFavorite.toggle()
        try? env.viewContext.save()
        isCurrentFavorite = phrase.isFavorite
    }

    /// Синхронизирует наблюдаемое зеркало избранного (вызывается при смене фразы).
    private func syncFavorite() {
        guard let phraseId = player.currentPhrase?.phraseId,
              let phrase = try? env.repository.phrase(phraseId: phraseId) else {
            isCurrentFavorite = false
            return
        }
        isCurrentFavorite = phrase.isFavorite
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

        if let session = learningSession {
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
            try? env.viewContext.save()

            // Прогресс урока — только для сессии одного урока (для «Сессии дня» lesson == nil,
            // статусы фраз уже обновлены SRS в их родных уроках).
            if let lesson = flow.lesson {
                SessionCompletion.applyLessonProgress(
                    env: env, lesson: lesson,
                    durationSeconds: duration,
                    phrasesReviewed: player.completedPhraseIds.count,
                    completedAt: completedAt
                )
            }
        }

        let newAchievements = SessionCompletion.evaluateAchievements(env: env, now: completedAt)
        let recommendations = SessionCompletion.buildRecommendations(env: env)

        env.lockScreen.clear()
        env.activeSessionID = nil
        env.refreshWidgetStats(now: completedAt)
        Haptics.success(enabled: env.settings.sessionCompleteVibration)

        flow.result = SessionResult(
            lessonTitle: flow.sessionTitle,
            completedAt: completedAt,
            durationSeconds: duration,
            phrasesCompleted: player.completedPhraseIds.count,
            phrasesTotal: player.totalPhrases,
            transitions: transitions,
            newAchievements: newAchievements,
            recommendations: recommendations,
            accuracy: nil
        )
        flow.step = .completed
    }

    /// Пользователь завершил сессию вручную. Засчитываем как завершённую, только если
    /// проиграна хотя бы одна фраза; иначе — отмена (запись сессии удаляется).
    func endEarly() {
        player.pause()
        if player.completedPhraseIds.isEmpty {
            abandon()
        } else {
            finish()
        }
    }

    /// Отмена сессии без единой завершённой фразы: чистим запись и lock screen.
    private func abandon() {
        didFinish = true
        if let session = learningSession {
            env.viewContext.delete(session)
            try? env.viewContext.save()
        }
        env.lockScreen.clear()
        env.activeSessionID = nil
        player.reset()
        flow.reset()
        env.selectedTab = .lessons
    }

    // MARK: - Now Playing

    func updateNowPlaying() {
        syncFavorite()
        guard let phrase = player.currentPhrase else { return }
        env.lockScreen.update(
            textEs: phrase.textEs,
            textRu: phrase.textRu,
            lessonTitle: flow.lesson?.titleRu ?? "",
            duration: player.currentDuration,
            elapsed: player.currentTime,
            rate: player.isPlaying ? player.speed : 0,
            trackNumber: player.currentPhraseIndex + 1,
            trackCount: player.totalPhrases,
            textMode: flow.config.lockScreenTextMode,
            sideOrder: flow.config.sideOrder
        )
    }
}
