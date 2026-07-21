import Foundation

/// Достижения (спека §10.2).
enum Achievement: String, CaseIterable, Identifiable {
    case firstSession
    case weekWarrior
    case monthMarathon
    case hundredSessions
    case allMastered
    case speedDemon
    case nightOwl

    var id: String { rawValue }

    var titleRu: String {
        switch self {
        case .firstSession: return "Первый шаг"
        case .weekWarrior: return "Неделя боевая"
        case .monthMarathon: return "Месячный марафон"
        case .hundredSessions: return "Сотня сессий"
        case .allMastered: return "Полный мастер"
        case .speedDemon: return "Скоро-говорун"
        case .nightOwl: return "Сова"
        }
    }

    var emoji: String {
        switch self {
        case .firstSession: return "🎯"
        case .weekWarrior: return "🔥"
        case .monthMarathon: return "🏆"
        case .hundredSessions: return "💯"
        case .allMastered: return "🎓"
        case .speedDemon: return "⚡️"
        case .nightOwl: return "🦉"
        }
    }

    var detailRu: String {
        switch self {
        case .firstSession: return "Первая завершённая сессия"
        case .weekWarrior: return "7 дней подряд"
        case .monthMarathon: return "30 дней подряд"
        case .hundredSessions: return "100 завершённых сессий"
        case .allMastered: return "Все фразы урока выучены"
        case .speedDemon: return "10 сессий на скорости 2.0x"
        case .nightOwl: return "5 сессий после 22:00"
        }
    }
}

/// Контекст для проверки достижений.
struct AchievementContext {
    var completedSessions: Int
    var currentStreak: Int
    var sessionsAtMaxSpeed: Int
    var nightSessions: Int
    var anyLessonFullyMastered: Bool
}

/// Хранение и разблокировка достижений.
final class AchievementsService {
    private let defaults: UserDefaults
    private let storageKey = "unlockedAchievements"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    var unlocked: Set<String> {
        get { Set(defaults.stringArray(forKey: storageKey) ?? []) }
        set { defaults.set(Array(newValue), forKey: storageKey) }
    }

    func isUnlocked(_ achievement: Achievement) -> Bool {
        unlocked.contains(achievement.rawValue)
    }

    /// Чистая проверка: какие достижения удовлетворены данным контекстом.
    static func satisfied(in context: AchievementContext) -> Set<Achievement> {
        var result: Set<Achievement> = []
        if context.completedSessions >= 1 { result.insert(.firstSession) }
        if context.completedSessions >= 100 { result.insert(.hundredSessions) }
        if context.currentStreak >= 7 { result.insert(.weekWarrior) }
        if context.currentStreak >= 30 { result.insert(.monthMarathon) }
        if context.anyLessonFullyMastered { result.insert(.allMastered) }
        if context.sessionsAtMaxSpeed >= 10 { result.insert(.speedDemon) }
        if context.nightSessions >= 5 { result.insert(.nightOwl) }
        return result
    }

    /// Разблокирует новые достижения по контексту, возвращает только вновь открытые.
    @discardableResult
    func evaluate(context: AchievementContext) -> [Achievement] {
        let satisfied = Self.satisfied(in: context)
        let already = unlocked
        let newlyUnlocked = satisfied.filter { !already.contains($0.rawValue) }
        if !newlyUnlocked.isEmpty {
            unlocked = already.union(newlyUnlocked.map(\.rawValue))
        }
        return newlyUnlocked.sorted { $0.rawValue < $1.rawValue }
    }
}
