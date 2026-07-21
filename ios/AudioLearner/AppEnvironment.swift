import ActivityKit
import CoreData
import Foundation
import Observation
import WidgetKit

/// Корневой контейнер зависимостей, внедряется в SwiftUI-окружение.
@MainActor
@Observable
final class AppEnvironment {
    let persistence: PersistenceController
    let repository: LessonRepository
    let settings: AppSettings
    let importService: FileImportService
    let statistics: StatisticsService
    let srs: SpacedRepeatService
    let achievements: AchievementsService
    let backup: BackupService

    @ObservationIgnored let audioSession = AudioSessionManager.shared
    /// Единый сервис lock screen на процесс (иначе копятся зомби remote-таргеты).
    @ObservationIgnored let lockScreen = LockScreenService()
    /// Единый сервис Live Activity на процесс (владелец — env, а не транзиентный VM, C13).
    @ObservationIgnored let liveActivity = LiveActivityService()
    /// ObjectID незавершённой сессии (для отмены при старте новой).
    @ObservationIgnored var activeSessionID: NSManagedObjectID?

    /// Активная вкладка (для перехода «Играть» из списка уроков в Сессию).
    var selectedTab: AppTab = .lessons
    /// URL для импорта, полученный через «Открыть в…» (Document Types).
    var pendingImportURL: URL?
    /// Флоу текущей сессии.
    let sessionFlow: SessionFlow
    /// Активный раннер аудио-сессии (владелец — env; позволяет headless-старт из интента, C12).
    var activeAudioSession: PlayerViewModel?

    init(inMemory: Bool = false) {
        let persistence = PersistenceController(inMemory: inMemory)
        self.persistence = persistence
        let repository = LessonRepository(context: persistence.viewContext)
        self.repository = repository
        self.settings = AppSettings()
        self.importService = FileImportService(repository: repository)
        self.statistics = StatisticsService()
        self.srs = SpacedRepeatService()
        self.achievements = AchievementsService()
        self.backup = BackupService(repository: repository)
        self.sessionFlow = SessionFlow()
        installIntentHandlers()
    }

    /// Подключает App Intents (виджет/Siri) к приложению.
    private func installIntentHandlers() {
        IntentActionCoordinator.shared.onStartDailySession = { [weak self] in
            self?.startDailySession() ?? false
        }
        // pause/resume идут через shared-плеер; onPlaybackStateChanged синхронизирует
        // Now Playing/Live Activity (C21).
        IntentActionCoordinator.shared.onPauseSession = { [weak self] in
            self?.sessionFlow.player.pause()
        }
        IntentActionCoordinator.shared.onResumeSession = { [weak self] in
            self?.sessionFlow.player.play()
        }
    }

    var viewContext: NSManagedObjectContext { persistence.viewContext }

    func onLaunch() {
        AppPaths.ensureDirectories()
        FileImportService.sweepTempImports() // подметаем осиротевшие папки импорта
        cleanupOrphanSessions()              // сессии, брошенные из-за kill приложения
        liveActivity.endAllOrphans()         // осиротевшие Live Activity после kill (C13)
        audioSession.activate()
        backup.createDailyBackupIfNeeded(settings: settings.snapshot())
        refreshWidgetStats()
    }

    /// Headless-запуск аудио-плеера: создаёт раннер и стартует воспроизведение без ожидания
    /// появления SessionPlayerView (нужно для старта из виджета/Siri, C12).
    func beginAudioPlayback() {
        let runner = PlayerViewModel(env: self, flow: sessionFlow)
        activeAudioSession = runner
        sessionFlow.step = .player
        runner.startSession()
    }

    /// Начинает сессию для урока: гасит прежнюю сессию, переключает вкладку и открывает выбор фраз.
    func startSession(for lesson: Lesson) {
        endActiveSession(abandoned: true)
        sessionFlow.begin(with: lesson, settings: settings)
        selectedTab = .session
    }

    /// Собирает и запускает «Сессию дня» из SRS-рекомендаций по всем урокам (D-23).
    /// - Returns: false, если повторять нечего (всё повторено).
    @discardableResult
    func startDailySession(now: Date = Date()) -> Bool {
        endActiveSession(abandoned: true)
        let lessons = (try? repository.allLessons()) ?? []
        let phrases = DailySession.build(
            lessons: lessons, srs: srs,
            limit: settings.dailySessionLimit,
            order: settings.dailySessionOrder,
            now: now
        )
        guard !phrases.isEmpty else { return false }
        sessionFlow.beginDaily(phrases: phrases, settings: settings)
        selectedTab = .session
        // «Сессия дня» стартует сразу: аудио — headless (работает из виджета/Siri, C12),
        // флеш-карты интерактивны (стартуют при появлении FlashcardView).
        if sessionFlow.config.playbackMode.isAudioQueue {
            beginAudioPlayback()
        } else {
            sessionFlow.step = .player
        }
        return true
    }

    /// Останавливает активное воспроизведение, очищает lock screen/Live Activity и, если
    /// незавершённая сессия брошена, удаляет её запись (не засчитывается в историю).
    func endActiveSession(abandoned: Bool) {
        sessionFlow.player.reset()
        lockScreen.clear()
        liveActivity.end() // завершаем Live Activity прежней сессии (C13)
        activeAudioSession = nil
        if abandoned, let id = activeSessionID,
           let session = try? viewContext.existingObject(with: id) as? LearningSession,
           session.completedAt == nil {
            viewContext.delete(session)
            try? viewContext.save()
        }
        activeSessionID = nil
    }

    /// Полностью очищает данные приложения: CoreData + файлы уроков/бэкапов (спека §4.9).
    func deleteAllData() {
        endActiveSession(abandoned: true)
        for lesson in (try? repository.allLessons()) ?? [] { viewContext.delete(lesson) }
        for session in (try? viewContext.fetch(LearningSession.fetchRequest())) ?? [] {
            viewContext.delete(session)
        }
        try? viewContext.save()
        try? FileManager.default.removeItem(at: AppPaths.lessonsDirectory)
        try? FileManager.default.removeItem(at: AppPaths.backupsDirectory)
        AppPaths.ensureDirectories()
        refreshWidgetStats()
    }

    /// Удаляет незавершённые сессии (completedAt == nil), оставшиеся после аварийного выхода.
    func cleanupOrphanSessions() {
        let request = LearningSession.fetchRequest()
        request.predicate = NSPredicate(format: "completedAt == nil")
        let orphans = (try? viewContext.fetch(request)) ?? []
        guard !orphans.isEmpty else { return }
        for session in orphans { viewContext.delete(session) }
        try? viewContext.save()
    }

    // MARK: - Widget stats

    func refreshWidgetStats(now: Date = Date()) {
        let request = LearningSession.fetchRequest()
        let sessions = (try? viewContext.fetch(request)) ?? []
        let todaySessions = sessions.filter { session in
            guard let done = session.completedAt else { return false }
            return Calendar.current.isDate(done, inSameDayAs: now)
        }
        let minutes = todaySessions.reduce(0) { $0 + Int($1.actualDurationSeconds) } / 60
        let streak = statistics.currentStreak(sessions: sessions, now: now)
        WidgetSharedStore.write(.init(
            date: now,
            minutes: minutes,
            sessions: todaySessions.count,
            streak: streak
        ))
        WidgetCenter.shared.reloadAllTimelines()
    }
}

/// Вкладки приложения.
enum AppTab: Hashable {
    case lessons, session, statistics, settings
}
