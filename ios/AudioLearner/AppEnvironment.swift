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

    /// Активная вкладка (для перехода «Играть» из списка уроков в Сессию).
    var selectedTab: AppTab = .lessons
    /// URL для импорта, полученный через «Открыть в…» (Document Types).
    var pendingImportURL: URL?
    /// Флоу текущей сессии.
    let sessionFlow: SessionFlow

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
    }

    var viewContext: NSManagedObjectContext { persistence.viewContext }

    func onLaunch() {
        AppPaths.ensureDirectories()
        FileImportService.sweepTempImports() // подметаем осиротевшие папки импорта
        audioSession.activate()
        backup.createDailyBackupIfNeeded(settings: settings.snapshot())
        refreshWidgetStats()
    }

    /// Начинает сессию для урока: переключает вкладку и открывает выбор фраз.
    func startSession(for lesson: Lesson) {
        sessionFlow.begin(with: lesson, settings: settings)
        selectedTab = .session
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
