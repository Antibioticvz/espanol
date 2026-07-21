import XCTest
@testable import AudioLearner

/// Разрешение конфликтов при повторном импорте (спека §11.2).
final class ImportConflictTests: AudioLearnerTestCase {

    private func firstPhraseId(_ lesson: Lesson) throws -> String {
        try XCTUnwrap(lesson.allLearnablePhrases.first).phraseId
    }

    func testUpdatePreservesPhraseProgress() throws {
        let lesson = try importFixture()
        let targetId = try firstPhraseId(lesson)

        // Прогрессируем фразу.
        let phrase = try XCTUnwrap(repository.phrase(phraseId: targetId))
        phrase.stateEnum = .inProgress
        phrase.reviewCount = 5
        let reviewDate = Date(timeIntervalSince1970: 1_700_000_000)
        phrase.lastReviewDate = reviewDate
        phrase.isFavorite = true
        try context.save()

        // Повторный импорт с «Обновить».
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        XCTAssertTrue(prepared.hasConflict)
        _ = try service.commit(prepared, resolution: .update)

        // Прогресс сохранён по phraseId.
        let after = try XCTUnwrap(repository.phrase(phraseId: targetId))
        XCTAssertEqual(after.stateEnum, .inProgress)
        XCTAssertEqual(after.reviewCount, 5)
        XCTAssertEqual(after.lastReviewDate, reviewDate)
        XCTAssertTrue(after.isFavorite)

        // Урок по-прежнему один, счётчики те же.
        XCTAssertEqual(try repository.allLessons().count, 1)
        let lessonAfter = try XCTUnwrap(repository.lesson(topicId: "04-hablar-de-mi-mismo"))
        XCTAssertEqual(lessonAfter.phrases.count, 9)
        XCTAssertEqual(lessonAfter.words.count, 4)
        XCTAssertEqual(lessonAfter.audioFiles.count, 28)

        // Прогресс-счётчики пересчитаны (1 inProgress).
        let progress = try XCTUnwrap(lessonAfter.progress)
        XCTAssertEqual(progress.phrasesInProgress, 1)
        XCTAssertEqual(progress.phrasesLearning, 12)
    }

    func testReplaceResetsPhraseProgress() throws {
        let lesson = try importFixture()
        let targetId = try firstPhraseId(lesson)

        let phrase = try XCTUnwrap(repository.phrase(phraseId: targetId))
        phrase.stateEnum = .mastered
        phrase.reviewCount = 9
        try context.save()

        // Повторный импорт с «Заменить».
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        _ = try service.commit(prepared, resolution: .replace)

        let after = try XCTUnwrap(repository.phrase(phraseId: targetId))
        XCTAssertEqual(after.stateEnum, .learning, "После замены state должен сброситься")
        XCTAssertEqual(after.reviewCount, 0)

        // Всё ещё ровно один урок (старый снесён).
        XCTAssertEqual(try repository.allLessons().count, 1)
    }

    func testCancelDoesNothing() throws {
        _ = try importFixture()
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        let result = try service.commit(prepared, resolution: .cancel)
        XCTAssertNil(result)
        XCTAssertEqual(try repository.allLessons().count, 1)
    }
}
