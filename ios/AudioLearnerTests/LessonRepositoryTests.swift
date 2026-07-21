import CoreData
import XCTest
@testable import AudioLearner

/// Поведение репозитория при удалении урока (D-17: сессии переживают удаление).
final class LessonRepositoryTests: AudioLearnerTestCase {

    func testDeletingLessonKeepsSessionsForHistory() throws {
        let lesson = try importFixture()

        // Синтетическая завершённая сессия, привязанная к уроку.
        let session = LearningSession(context: context)
        session.sessionId = UUID()
        session.startedAt = Date()
        session.completedAt = Date()
        session.actualDurationSeconds = 600
        session.speed = 1.0
        session.lesson = lesson
        try context.save()

        XCTAssertEqual(try context.fetch(LearningSession.fetchRequest()).count, 1)

        // Удаляем урок.
        try repository.delete(lesson)

        // Сессия жива, но отвязана от урока.
        let sessions = try context.fetch(LearningSession.fetchRequest())
        XCTAssertEqual(sessions.count, 1, "Сессия должна пережить удаление урока")
        XCTAssertNil(sessions.first?.lesson, "lesson должен обнулиться (nullify)")

        // Урок и его фразы удалены.
        XCTAssertEqual(try repository.allLessons().count, 0)
        XCTAssertEqual(try context.fetch(Phrase.fetchRequest()).count, 0)
        XCTAssertEqual(try context.fetch(AudioFile.fetchRequest()).count, 0)
    }

    func testStatisticsWorkWithLessonlessSessions() throws {
        let lesson = try importFixture()
        let now = Date()
        let session = LearningSession(context: context)
        session.sessionId = UUID()
        session.startedAt = now
        session.completedAt = now
        session.actualDurationSeconds = 1800 // 30 мин
        session.speed = 1.0
        session.lesson = lesson
        try context.save()
        try repository.delete(lesson)

        // StatisticsService не обращается к session.lesson — считает корректно.
        let sessions = try context.fetch(LearningSession.fetchRequest())
        let stats = StatisticsService()
        let summary = stats.summary(sessions: sessions, now: now)
        XCTAssertEqual(summary.completedSessions, 1)
        XCTAssertEqual(summary.totalMinutes, 30)
        XCTAssertEqual(summary.currentStreak, 1)
    }
}
