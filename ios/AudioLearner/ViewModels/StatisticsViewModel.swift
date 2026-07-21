import CoreData
import Foundation
import Observation

enum StatsPeriod: String, CaseIterable, Identifiable {
    case today, week, month, all
    var id: String { rawValue }
    var titleRu: String {
        switch self {
        case .today: return "Сегодня"
        case .week: return "Неделя"
        case .month: return "Месяц"
        case .all: return "Всё время"
        }
    }
}

/// Данные о фразе, требующей повтора.
struct DueWord: Identifiable {
    let id: String
    let textEs: String
    let textRu: String
    let urgency: ReviewUrgency
    let daysSince: Int
}

/// Агрегаты по одному уроку для раздела «По урокам».
struct LessonStatsRow: Identifiable {
    let id: String
    let title: String
    let topicNumber: Int
    let mastered: Int
    let total: Int
    let sessions: Int
    var percent: Double { total > 0 ? Double(mastered) / Double(total) : 0 }
}

/// Экран статистики: периоды, сводка, streak, heatmap, слова к повтору, экспорт (спека §4.8).
/// Данные считаются в reload() (один проход по базе) и кэшируются — body не делает выборок.
@MainActor
@Observable
final class StatisticsViewModel {
    @ObservationIgnored let env: AppEnvironment

    var period: StatsPeriod = .all {
        didSet { if oldValue != period { reload() } }
    }

    // Кэш результатов (пересчитывается в reload()).
    private(set) var summary = StatisticsSummary()
    private(set) var heatmap: [DayActivity] = []
    private(set) var lessonRows: [LessonStatsRow] = []
    private(set) var dueWords: [DueWord] = []
    private(set) var totalSeconds = 0

    init(env: AppEnvironment) {
        self.env = env
    }

    /// Пересчитывает все секции. Вызывать onAppear и по NSManagedObjectContextDidSave.
    func reload(now: Date = Date()) {
        let allSessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
        let lessons = (try? env.repository.allLessons()) ?? []
        let stats = env.statistics

        let periodSessions = filterByPeriod(allSessions, now: now)
        var s = stats.summary(sessions: periodSessions, now: now)
        s.currentStreak = stats.currentStreak(sessions: allSessions, now: now)
        s.bestStreak = stats.bestStreak(sessions: allSessions)
        summary = s
        totalSeconds = stats.completed(periodSessions).reduce(0) { $0 + Int($1.actualDurationSeconds) }

        heatmap = stats.heatmap(sessions: allSessions)

        lessonRows = lessons.map { lesson in
            let learnable = lesson.allLearnablePhrases
            let mastered = learnable.filter { $0.stateEnum == .mastered }.count
            return LessonStatsRow(
                id: lesson.topicId,
                title: lesson.titleRu,
                topicNumber: Int(lesson.topicNumber),
                mastered: mastered,
                total: learnable.count,
                sessions: lesson.sessions.count
            )
        }
        .sorted { $0.topicNumber < $1.topicNumber }

        dueWords = computeDueWords(lessons: lessons, now: now)
    }

    private func filterByPeriod(_ sessions: [LearningSession], now: Date) -> [LearningSession] {
        let calendar = Calendar.current
        let completed = sessions.filter { $0.completedAt != nil }
        switch period {
        case .all: return completed
        case .today: return completed.filter { calendar.isDate($0.completedAt!, inSameDayAs: now) }
        case .week:
            let start = calendar.date(byAdding: .day, value: -7, to: now)!
            return completed.filter { $0.completedAt! >= start }
        case .month:
            let start = calendar.date(byAdding: .month, value: -1, to: now)!
            return completed.filter { $0.completedAt! >= start }
        }
    }

    private func computeDueWords(lessons: [Lesson], now: Date) -> [DueWord] {
        var result: [DueWord] = []
        for lesson in lessons {
            for phrase in env.srs.recommendedPhrases(in: lesson, now: now) {
                let urgency = env.srs.urgency(for: phrase, now: now)
                let days = phrase.lastReviewDate
                    .map { Calendar.current.dateComponents([.day], from: $0, to: now).day ?? 0 } ?? -1
                result.append(DueWord(
                    id: phrase.phraseId,
                    textEs: phrase.textEs,
                    textRu: phrase.textRu,
                    urgency: urgency,
                    daysSince: days
                ))
            }
        }
        let order: [ReviewUrgency] = [.urgent, .soon, .normal]
        return result.sorted { (order.firstIndex(of: $0.urgency) ?? 9) < (order.firstIndex(of: $1.urgency) ?? 9) }
    }

    func exportCSV() -> URL? {
        let allSessions = (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
        let csv = env.statistics.activityCSV(sessions: allSessions)
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return try? env.statistics.writeCSV(csv, filename: "stats_\(formatter.string(from: Date())).csv")
    }
}
