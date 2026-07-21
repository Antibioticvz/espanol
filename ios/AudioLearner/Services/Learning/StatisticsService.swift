import CoreData
import Foundation

/// Активность за один день (для heatmap-календаря).
struct DayActivity: Equatable, Identifiable {
    let day: Date
    let sessionsCount: Int
    let minutes: Int

    var id: Date { day }

    /// Уровень интенсивности 0–3 для окраски ячейки heatmap.
    var intensity: Int {
        switch minutes {
        case 0: return 0
        case 1..<15: return 1
        case 15..<40: return 2
        default: return 3
        }
    }
}

/// Сводные показатели за период.
struct StatisticsSummary: Equatable {
    var completedSessions: Int = 0
    var totalMinutes: Int = 0
    var currentStreak: Int = 0
    var bestStreak: Int = 0

    var averageSessionMinutes: Int {
        completedSessions > 0 ? totalMinutes / completedSessions : 0
    }
}

/// Расчёты статистики: streak, heatmap, агрегаты, экспорт CSV (спека §4.8, §10).
struct StatisticsService {
    var calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.firstWeekday = 2 // понедельник
        return c
    }()

    // MARK: - Pure streak algorithms

    /// Текущая полоса подряд идущих активных дней, заканчивающаяся сегодня или вчера.
    func currentStreak(activeDays: Set<Date>, today: Date) -> Int {
        let todayStart = calendar.startOfDay(for: today)
        var cursor: Date
        if activeDays.contains(todayStart) {
            cursor = todayStart
        } else if let yesterday = calendar.date(byAdding: .day, value: -1, to: todayStart),
                  activeDays.contains(yesterday) {
            cursor = yesterday
        } else {
            return 0
        }
        var streak = 0
        while activeDays.contains(cursor) {
            streak += 1
            guard let prev = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = prev
        }
        return streak
    }

    /// Лучшая полоса подряд идущих активных дней за всю историю.
    func bestStreak(activeDays: Set<Date>) -> Int {
        guard !activeDays.isEmpty else { return 0 }
        let sorted = activeDays.sorted()
        var best = 1
        var run = 1
        for i in 1..<sorted.count {
            if let next = calendar.date(byAdding: .day, value: 1, to: sorted[i - 1]),
               next == sorted[i] {
                run += 1
            } else {
                run = 1
            }
            best = max(best, run)
        }
        return best
    }

    // MARK: - Session-based

    func completed(_ sessions: [LearningSession]) -> [LearningSession] {
        sessions.filter { $0.completedAt != nil }
    }

    func activeDays(from sessions: [LearningSession]) -> Set<Date> {
        Set(completed(sessions).compactMap { $0.completedAt.map { calendar.startOfDay(for: $0) } })
    }

    func currentStreak(sessions: [LearningSession], now: Date = Date()) -> Int {
        currentStreak(activeDays: activeDays(from: sessions), today: now)
    }

    func bestStreak(sessions: [LearningSession]) -> Int {
        bestStreak(activeDays: activeDays(from: sessions))
    }

    /// Heatmap-данные за диапазон дат (по одному DayActivity на каждый день с активностью).
    func heatmap(sessions: [LearningSession], from: Date? = nil, to: Date? = nil) -> [DayActivity] {
        var buckets: [Date: (count: Int, seconds: Int)] = [:]
        for session in completed(sessions) {
            guard let done = session.completedAt else { continue }
            let day = calendar.startOfDay(for: done)
            if let from, day < calendar.startOfDay(for: from) { continue }
            if let to, day > calendar.startOfDay(for: to) { continue }
            var entry = buckets[day] ?? (0, 0)
            entry.count += 1
            entry.seconds += Int(session.actualDurationSeconds)
            buckets[day] = entry
        }
        return buckets
            .map { DayActivity(day: $0.key, sessionsCount: $0.value.count, minutes: $0.value.seconds / 60) }
            .sorted { $0.day < $1.day }
    }

    func summary(sessions: [LearningSession], now: Date = Date()) -> StatisticsSummary {
        let done = completed(sessions)
        let totalSeconds = done.reduce(0) { $0 + Int($1.actualDurationSeconds) }
        return StatisticsSummary(
            completedSessions: done.count,
            totalMinutes: totalSeconds / 60,
            currentStreak: currentStreak(sessions: sessions, now: now),
            bestStreak: bestStreak(sessions: sessions)
        )
    }

    // MARK: - CSV export

    /// CSV прогресса фраз урока (спека §4.2 «Экспортировать прогресс»).
    func phrasesCSV(for lesson: Lesson) -> String {
        var rows = ["phrase_id,es,ru,state,review_count,last_review,next_review"]
        let formatter = ISO8601DateFormatter()
        for phrase in lesson.allLearnablePhrases.sorted(by: { $0.orderIndex < $1.orderIndex }) {
            let last = phrase.lastReviewDate.map { formatter.string(from: $0) } ?? ""
            let next = phrase.nextReviewDate.map { formatter.string(from: $0) } ?? ""
            rows.append([
                csvEscape(phrase.phraseId),
                csvEscape(phrase.textEs),
                csvEscape(phrase.textRu),
                phrase.state,
                String(phrase.reviewCount),
                last,
                next
            ].joined(separator: ","))
        }
        return rows.joined(separator: "\n")
    }

    /// CSV сводки активности по дням.
    func activityCSV(sessions: [LearningSession]) -> String {
        var rows = ["date,sessions,minutes"]
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        for day in heatmap(sessions: sessions) {
            rows.append("\(formatter.string(from: day.day)),\(day.sessionsCount),\(day.minutes)")
        }
        return rows.joined(separator: "\n")
    }

    private func csvEscape(_ value: String) -> String {
        if value.contains(",") || value.contains("\"") || value.contains("\n") {
            return "\"" + value.replacingOccurrences(of: "\"", with: "\"\"") + "\""
        }
        return value
    }

    /// Записывает CSV в Documents/AudioLearner/exports и возвращает URL.
    func writeCSV(_ csv: String, filename: String) throws -> URL {
        AppPaths.ensureDirectories()
        let url = AppPaths.exportsDirectory.appendingPathComponent(filename)
        try csv.write(to: url, atomically: true, encoding: .utf8)
        return url
    }
}
