import CoreData
import XCTest
@testable import AudioLearner

/// «Сессия дня» (v1.2, D-23): подбор, приоритет, лимит, кросс-урочность, порядок.
@MainActor
final class DailySessionTests: AudioLearnerTestCase {

    private func c(_ id: String, urgency: Int, days: Int) -> DailySession.Candidate {
        DailySession.Candidate(phraseId: id, urgencyRank: urgency, daysSince: days)
    }

    // MARK: - Pure selection

    func testSelectPrioritizesUrgentThenMoreOverdue() {
        let candidates = [
            c("normal", urgency: 2, days: 100),
            c("urgent-old", urgency: 0, days: 10),
            c("urgent-new", urgency: 0, days: 3),
            c("soon", urgency: 1, days: 5)
        ]
        let ids = DailySession.select(candidates, limit: 10, order: .weakestFirst)
        XCTAssertEqual(ids, ["urgent-old", "urgent-new", "soon", "normal"])
    }

    func testSelectRespectsLimit() {
        let candidates = (0..<50).map { c("p\($0)", urgency: 0, days: $0) }
        let ids = DailySession.select(candidates, limit: 30, order: .weakestFirst)
        XCTAssertEqual(ids.count, 30)
    }

    func testSelectCrossLessonFlatten() {
        // Кандидаты из двух «уроков» (разные префиксы) — сливаются и приоритезируются вместе.
        let candidates = [
            c("L1-a", urgency: 1, days: 5),
            c("L2-b", urgency: 0, days: 5)
        ]
        let ids = DailySession.select(candidates, limit: 10, order: .weakestFirst)
        XCTAssertEqual(ids.first, "L2-b", "срочная из другого урока — первой")
        XCTAssertEqual(Set(ids), ["L1-a", "L2-b"])
    }

    func testSelectShuffleKeepsAllUnderLimit() {
        let candidates = (0..<5).map { c("p\($0)", urgency: 0, days: 0) }
        let ids = DailySession.select(candidates, limit: 30, order: .shuffle)
        XCTAssertEqual(ids.count, 5)
        XCTAssertEqual(Set(ids), Set(candidates.map(\.phraseId)))
    }

    func testSelectShuffleRespectsLimit() {
        let candidates = (0..<50).map { c("p\($0)", urgency: 0, days: 0) }
        let ids = DailySession.select(candidates, limit: 30, order: .shuffle)
        XCTAssertEqual(ids.count, 30)
    }

    // MARK: - Build (integration)

    func testBuildCollectsDuePhrasesWithLimit() throws {
        let lesson = try importFixture()
        let srs = SpacedRepeatService()
        // Все 13 фраз новые (lastReviewDate == nil) → все рекомендованы.
        let all = DailySession.build(lessons: [lesson], srs: srs, limit: 30, order: .weakestFirst)
        XCTAssertEqual(all.count, 13)

        let limited = DailySession.build(lessons: [lesson], srs: srs, limit: 5, order: .weakestFirst)
        XCTAssertEqual(limited.count, 5)
        XCTAssertTrue(limited.allSatisfy { $0.lesson?.objectID == lesson.objectID })
    }

    func testBuildExcludesMasteredAndRecent() throws {
        let lesson = try importFixture()
        let srs = SpacedRepeatService()
        let now = Date()
        let phrases = lesson.allLearnablePhrases
        // Одна mastered (не рекомендуется), одна недавно повторённая learning (не due).
        phrases[0].stateEnum = .mastered
        phrases[0].lastReviewDate = now
        phrases[1].stateEnum = .learning
        phrases[1].lastReviewDate = Calendar.current.date(byAdding: .day, value: -1, to: now)
        try context.save()

        let due = DailySession.build(lessons: [lesson], srs: srs, limit: 30, order: .weakestFirst, now: now)
        let ids = Set(due.map(\.phraseId))
        XCTAssertFalse(ids.contains(phrases[0].phraseId))
        XCTAssertFalse(ids.contains(phrases[1].phraseId))
        XCTAssertEqual(due.count, 11)
    }
}
