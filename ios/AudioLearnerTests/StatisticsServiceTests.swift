import CoreData
import XCTest
@testable import AudioLearner

/// Статистика: streak, heatmap, CSV (спека §4.8, §10).
final class StatisticsServiceTests: AudioLearnerTestCase {

    private var stats: StatisticsService!
    private var calendar: Calendar!
    private var lesson: Lesson!

    override func setUpWithError() throws {
        try super.setUpWithError()
        var service = StatisticsService()
        var cal = Calendar(identifier: .gregorian)
        cal.firstWeekday = 2
        service.calendar = cal
        stats = service
        calendar = cal
        // Заглушечный урок для привязки сессий.
        lesson = Lesson(context: context)
        lesson.topicId = "test-topic"
        lesson.titleRu = "Тест"
        lesson.createdAt = Date()
        lesson.importedAt = Date()
        lesson.generatorVersion = "t"
    }

    @discardableResult
    private func makeSession(daysAgo: Int, minutes: Int, completed: Bool = true, now: Date) -> LearningSession {
        let session = LearningSession(context: context)
        session.sessionId = UUID()
        session.startedAt = calendar.date(byAdding: .day, value: -daysAgo, to: now)!
        session.actualDurationSeconds = Int64(minutes * 60)
        session.speed = 1.0
        session.lesson = lesson
        if completed {
            session.completedAt = calendar.date(byAdding: .day, value: -daysAgo, to: now)!
        }
        return session
    }

    private func allSessions() throws -> [LearningSession] {
        try context.fetch(LearningSession.fetchRequest())
    }

    // MARK: - Streak

    func testCurrentStreakConsecutiveDaysIncludingToday() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 30, now: now)
        makeSession(daysAgo: 1, minutes: 20, now: now)
        makeSession(daysAgo: 2, minutes: 25, now: now)
        try context.save()

        XCTAssertEqual(stats.currentStreak(sessions: try allSessions(), now: now), 3)
    }

    func testCurrentStreakBreaksOnGap() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 30, now: now)
        makeSession(daysAgo: 1, minutes: 20, now: now)
        // пропуск дня 2
        makeSession(daysAgo: 3, minutes: 25, now: now)
        try context.save()

        XCTAssertEqual(stats.currentStreak(sessions: try allSessions(), now: now), 2)
    }

    func testCurrentStreakZeroWhenNoRecentActivity() throws {
        let now = Date()
        makeSession(daysAgo: 5, minutes: 30, now: now)
        try context.save()
        XCTAssertEqual(stats.currentStreak(sessions: try allSessions(), now: now), 0)
    }

    func testBestStreak() throws {
        let now = Date()
        // Полоса 3 дня: -10, -9, -8.
        makeSession(daysAgo: 10, minutes: 10, now: now)
        makeSession(daysAgo: 9, minutes: 10, now: now)
        makeSession(daysAgo: 8, minutes: 10, now: now)
        // Полоса 2 дня: -1, 0.
        makeSession(daysAgo: 1, minutes: 10, now: now)
        makeSession(daysAgo: 0, minutes: 10, now: now)
        try context.save()

        XCTAssertEqual(stats.bestStreak(sessions: try allSessions()), 3)
        XCTAssertEqual(stats.currentStreak(sessions: try allSessions(), now: now), 2)
    }

    func testUncompletedSessionsIgnored() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 30, completed: false, now: now)
        try context.save()
        XCTAssertEqual(stats.currentStreak(sessions: try allSessions(), now: now), 0)
    }

    // MARK: - Heatmap

    func testHeatmapAggregatesSameDay() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 20, now: now)
        makeSession(daysAgo: 0, minutes: 25, now: now)
        makeSession(daysAgo: 2, minutes: 10, now: now)
        try context.save()

        let heatmap = stats.heatmap(sessions: try allSessions())
        XCTAssertEqual(heatmap.count, 2, "Два активных дня")
        let today = try XCTUnwrap(heatmap.last)
        XCTAssertEqual(today.sessionsCount, 2)
        XCTAssertEqual(today.minutes, 45)
        XCTAssertEqual(today.intensity, 3) // > 40 минут
    }

    func testSummary() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 30, now: now)
        makeSession(daysAgo: 1, minutes: 10, now: now)
        try context.save()

        let summary = stats.summary(sessions: try allSessions(), now: now)
        XCTAssertEqual(summary.completedSessions, 2)
        XCTAssertEqual(summary.totalMinutes, 40)
        XCTAssertEqual(summary.averageSessionMinutes, 20)
        XCTAssertEqual(summary.currentStreak, 2)
    }

    // MARK: - CSV

    func testActivityCSV() throws {
        let now = Date()
        makeSession(daysAgo: 0, minutes: 30, now: now)
        try context.save()

        let csv = stats.activityCSV(sessions: try allSessions())
        let lines = csv.split(separator: "\n")
        XCTAssertEqual(lines.first, "date,sessions,minutes")
        XCTAssertEqual(lines.count, 2)
        XCTAssertTrue(csv.contains(",1,30"))
    }

    func testPhrasesCSVForLesson() throws {
        let imported = try importFixture()
        let csv = stats.phrasesCSV(for: imported)
        let lines = csv.split(separator: "\n")
        XCTAssertEqual(lines.first, "phrase_id,es,ru,state,review_count,last_review,next_review")
        // 13 обучаемых элементов + заголовок.
        XCTAssertEqual(lines.count, 14)
        XCTAssertTrue(csv.contains("04-b1-llamarse-01"))
    }

    func testCSVEscapingHandlesCommas() throws {
        let imported = try importFixture()
        // Фраза с запятой должна быть в кавычках.
        let phrase = try XCTUnwrap(imported.allLearnablePhrases.first { $0.textEs.contains(",") })
        let csv = stats.phrasesCSV(for: imported)
        XCTAssertTrue(csv.contains("\"\(phrase.textEs)\""),
                      "Текст с запятой должен экранироваться кавычками")
    }
}
