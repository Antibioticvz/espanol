import CoreData
import XCTest
@testable import AudioLearner

/// Логика интервального повторения (спека §9).
final class SpacedRepeatServiceTests: AudioLearnerTestCase {

    private let srs = SpacedRepeatService()

    private func makePhrase(state: PhraseState = .learning, reviewCount: Int64 = 0) -> Phrase {
        let phrase = Phrase(context: context)
        phrase.phraseId = "test-\(UUID().uuidString)"
        phrase.textEs = "es"
        phrase.textRu = "ru"
        phrase.stateEnum = state
        phrase.reviewCount = reviewCount
        return phrase
    }

    // MARK: - Pure boundary rules

    func testStateTransitionBoundaries() {
        // learning → inProgress ровно на 3.
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .learning, reviewCount: 2), .learning)
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .learning, reviewCount: 3), .inProgress)
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .learning, reviewCount: 4), .inProgress)

        // inProgress → mastered ровно на 8.
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .inProgress, reviewCount: 7), .inProgress)
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .inProgress, reviewCount: 8), .mastered)

        // mastered остаётся mastered.
        XCTAssertEqual(SpacedRepeatService.evaluateState(current: .mastered, reviewCount: 100), .mastered)
    }

    func testRegisterReviewAdvancesLearningToInProgressAtThree() throws {
        let phrase = makePhrase(state: .learning, reviewCount: 2)
        let transition = srs.registerReview(phrase)
        XCTAssertEqual(phrase.reviewCount, 3)
        XCTAssertEqual(phrase.stateEnum, .inProgress)
        XCTAssertEqual(transition?.oldState, .learning)
        XCTAssertEqual(transition?.newState, .inProgress)
        XCTAssertNotNil(phrase.lastReviewDate)
        XCTAssertNotNil(phrase.nextReviewDate)
    }

    func testRegisterReviewNoTransitionBeforeThreshold() throws {
        let phrase = makePhrase(state: .learning, reviewCount: 0)
        let transition = srs.registerReview(phrase)
        XCTAssertEqual(phrase.reviewCount, 1)
        XCTAssertEqual(phrase.stateEnum, .learning)
        XCTAssertNil(transition)
    }

    func testRegisterReviewAdvancesInProgressToMasteredAtEight() throws {
        let phrase = makePhrase(state: .inProgress, reviewCount: 7)
        let transition = srs.registerReview(phrase)
        XCTAssertEqual(phrase.reviewCount, 8)
        XCTAssertEqual(phrase.stateEnum, .mastered)
        XCTAssertEqual(transition?.newState, .mastered)
    }

    func testStatisticsUpdatedOnReview() throws {
        let phrase = makePhrase()
        _ = srs.registerReview(phrase)
        let stats = try XCTUnwrap(phrase.statistics)
        XCTAssertEqual(stats.totalReviewCount, 1)
        XCTAssertNotNil(stats.lastReviewedAt)
    }

    // MARK: - Recommendations by date

    func testRecommendationsByLastReviewDate() throws {
        let lesson = try importFixture()
        let now = Date()
        let calendar = Calendar.current
        let phrases = lesson.allLearnablePhrases

        // Фраза A: learning, повторяли 1 день назад → не рекомендуется (< 3 дней).
        let a = phrases[0]
        a.stateEnum = .learning
        a.lastReviewDate = calendar.date(byAdding: .day, value: -1, to: now)

        // Фраза B: learning, повторяли 5 дней назад → рекомендуется (> 3 дней).
        let b = phrases[1]
        b.stateEnum = .learning
        b.lastReviewDate = calendar.date(byAdding: .day, value: -5, to: now)

        // Фраза C: inProgress, повторяли 4 дня назад → не рекомендуется (< 7 дней).
        let c = phrases[2]
        c.stateEnum = .inProgress
        c.lastReviewDate = calendar.date(byAdding: .day, value: -4, to: now)

        // Фраза D: inProgress, повторяли 10 дней назад → рекомендуется (> 7 дней).
        let d = phrases[3]
        d.stateEnum = .inProgress
        d.lastReviewDate = calendar.date(byAdding: .day, value: -10, to: now)

        // Фраза E: mastered → никогда не рекомендуется.
        let e = phrases[4]
        e.stateEnum = .mastered
        e.lastReviewDate = calendar.date(byAdding: .day, value: -100, to: now)

        // Остальные фразы — новые (lastReviewDate == nil) → рекомендуются.
        for phrase in phrases[5...] {
            phrase.lastReviewDate = nil
            phrase.stateEnum = .learning
        }
        try context.save()

        let recommended = Set(srs.recommendedPhrases(in: lesson, now: now).map(\.phraseId))
        XCTAssertFalse(recommended.contains(a.phraseId), "A не должна рекомендоваться")
        XCTAssertTrue(recommended.contains(b.phraseId), "B должна рекомендоваться")
        XCTAssertFalse(recommended.contains(c.phraseId), "C не должна рекомендоваться")
        XCTAssertTrue(recommended.contains(d.phraseId), "D должна рекомендоваться")
        XCTAssertFalse(recommended.contains(e.phraseId), "mastered E не рекомендуется")
    }

    func testUrgencyClassification() throws {
        let now = Date()
        let calendar = Calendar.current

        let newPhrase = makePhrase(state: .learning)
        newPhrase.lastReviewDate = nil
        XCTAssertEqual(srs.urgency(for: newPhrase, now: now), .urgent)

        let mastered = makePhrase(state: .mastered)
        mastered.lastReviewDate = calendar.date(byAdding: .day, value: -30, to: now)
        XCTAssertEqual(srs.urgency(for: mastered, now: now), .notDue)

        let learningRecent = makePhrase(state: .learning)
        learningRecent.lastReviewDate = calendar.date(byAdding: .day, value: -1, to: now)
        XCTAssertEqual(srs.urgency(for: learningRecent, now: now), .normal)
    }
}
