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
@Observable
final class StatisticsViewModel {
    @ObservationIgnored let env: AppEnvironment
    var period: StatsPeriod = .all

    init(env: AppEnvironment) {
        self.env = env
    }

    private func allSessions() -> [LearningSession] {
        (try? env.viewContext.fetch(LearningSession.fetchRequest())) ?? []
    }

    private func allLessons() -> [Lesson] {
        (try? env.repository.allLessons()) ?? []
    }

    /// Сессии, попадающие в выбранный период.
    func periodSessions(now: Date = Date()) -> [LearningSession] {
        let calendar = Calendar.current
        let sessions = allSessions().filter { $0.completedAt != nil }
        switch period {
        case .all:
            return sessions
        case .today:
            return sessions.filter { calendar.isDate($0.completedAt!, inSameDayAs: now) }
        case .week:
            let start = calendar.date(byAdding: .day, value: -7, to: now)!
            return sessions.filter { $0.completedAt! >= start }
        case .month:
            let start = calendar.date(byAdding: .month, value: -1, to: now)!
            return sessions.filter { $0.completedAt! >= start }
        }
    }

    var summary: StatisticsSummary {
        // streak считаем по всей истории, остальные показатели — по периоду.
        var s = env.statistics.summary(sessions: periodSessions())
        let all = allSessions()
        s.currentStreak = env.statistics.currentStreak(sessions: all)
        s.bestStreak = env.statistics.bestStreak(sessions: all)
        return s
    }

    var heatmap: [DayActivity] {
        env.statistics.heatmap(sessions: allSessions())
    }

    var lessonRows: [LessonStatsRow] {
        allLessons().map { lesson in
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
    }

    /// Слова/фразы к повтору, сгруппированные по срочности.
    func dueWords(now: Date = Date()) -> [DueWord] {
        var result: [DueWord] = []
        for lesson in allLessons() {
            for phrase in env.srs.recommendedPhrases(in: lesson, now: now) {
                let urgency = env.srs.urgency(for: phrase, now: now)
                let days: Int
                if let last = phrase.lastReviewDate {
                    days = Calendar.current.dateComponents([.day], from: last, to: now).day ?? 0
                } else {
                    days = -1
                }
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
        return result.sorted { lhs, rhs in
            (order.firstIndex(of: lhs.urgency) ?? 9) < (order.firstIndex(of: rhs.urgency) ?? 9)
        }
    }

    func exportCSV() -> URL? {
        let csv = env.statistics.activityCSV(sessions: allSessions())
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return try? env.statistics.writeCSV(csv, filename: "stats_\(formatter.string(from: Date())).csv")
    }
}
