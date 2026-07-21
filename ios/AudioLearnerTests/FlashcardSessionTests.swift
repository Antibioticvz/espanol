import XCTest
@testable import AudioLearner

/// Чистая логика колоды флеш-карт (v1.1, D-19).
final class FlashcardSessionTests: XCTestCase {

    func testDeckBuildDedupesAndPreservesOrder() {
        let s = FlashcardSession(phraseIds: ["a", "b", "a", "c", "b"])
        XCTAssertEqual(s.deck, ["a", "b", "c"])
        XCTAssertEqual(s.totalCards, 3)
        XCTAssertEqual(s.currentId, "a")
        XCTAssertFalse(s.isFinished)
    }

    func testMarkKnownAdvancesAndCompletes() {
        var s = FlashcardSession(phraseIds: ["a", "b"])
        s.markKnown()
        XCTAssertEqual(s.currentId, "b")
        XCTAssertEqual(s.completedCount, 1)
        s.markKnown()
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.completedCount, 2)
        XCTAssertNil(s.currentId)
    }

    func testMarkUnknownRequeuesToEnd() {
        var s = FlashcardSession(phraseIds: ["a", "b", "c"])
        s.markUnknown() // a уходит в конец
        XCTAssertEqual(s.currentId, "b")
        XCTAssertEqual(s.deck, ["b", "c", "a"])
        XCTAssertEqual(s.completedCount, 0, "повтор не засчитывается как завершение")
        XCTAssertEqual(s.remainingCount, 3)
    }

    func testUnknownThenKnownEventuallyFinishes() {
        var s = FlashcardSession(phraseIds: ["a"])
        s.markUnknown()
        XCTAssertEqual(s.currentId, "a", "единственная карта возвращается к себе же")
        XCTAssertFalse(s.isFinished)
        s.markKnown()
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.completedCount, 1)
    }

    func testAccuracyFirstTryOnly() {
        var s = FlashcardSession(phraseIds: ["a", "b", "c", "d"])
        s.markKnown()   // a — верно с первого раза
        s.markUnknown() // b — неверно с первого раза (в конец)
        s.markKnown()   // c — верно с первого раза
        s.markKnown()   // d — верно с первого раза
        s.markKnown()   // b — второй показ, «Знал», но НЕ с первого раза
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.completedCount, 4)
        XCTAssertEqual(s.knownFirstTry, 3)
        XCTAssertEqual(s.accuracy, 0.75, accuracy: 0.0001)
    }

    func testAllKnownFirstTryIsFullAccuracy() {
        var s = FlashcardSession(phraseIds: ["a", "b", "c"])
        s.markKnown(); s.markKnown(); s.markKnown()
        XCTAssertEqual(s.accuracy, 1.0, accuracy: 0.0001)
    }

    func testEmptyDeck() {
        let s = FlashcardSession(phraseIds: [])
        XCTAssertTrue(s.isFinished)
        XCTAssertEqual(s.totalCards, 0)
        XCTAssertEqual(s.accuracy, 0)
    }
}
