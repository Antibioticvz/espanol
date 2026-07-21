import CoreData
import XCTest
@testable import AudioLearner

/// Интеграция режима флеш-карт: направление, SRS-обновления, точность (v1.1, D-19).
@MainActor
final class FlashcardViewModelTests: AudioLearnerTestCase {

    /// Готовит env + флеш-карт-сессию. `singleFirst` — оставить одну (первую) карту.
    private func makeFlashcards(
        direction: FlashcardDirection = .esToRu,
        singleFirst: Bool = false
    ) throws -> (env: AppEnvironment, vm: FlashcardViewModel, lesson: Lesson) {
        let env = AppEnvironment(inMemory: true)
        let service = FileImportService(repository: env.repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        let lesson = try XCTUnwrap(try service.commit(prepared, resolution: .replace))
        env.sessionFlow.begin(with: lesson, settings: env.settings)
        env.sessionFlow.config.playbackMode = .flashcards
        env.sessionFlow.config.flashcardDirection = direction
        env.sessionFlow.config.flashcardAutoplay = false // без аудио в тестах
        env.sessionFlow.config.trackProgress = true
        if singleFirst {
            let firstId = try XCTUnwrap(lesson.allLearnablePhrases.first).phraseId
            env.sessionFlow.selectedPhraseIds = [firstId]
        }
        let vm = FlashcardViewModel(env: env, flow: env.sessionFlow)
        vm.start()
        return (env, vm, lesson)
    }

    func testDirectionEsToRu() throws {
        let (_, vm, _) = try makeFlashcards(direction: .esToRu)
        let phrase = try XCTUnwrap(vm.currentPhrase)
        XCTAssertEqual(vm.questionText, phrase.textEs)
        XCTAssertEqual(vm.answerText, phrase.textRu)
        XCTAssertEqual(vm.questionLanguageLabel, "ES")
        XCTAssertEqual(vm.answerLanguageLabel, "RU")
    }

    func testDirectionRuToEs() throws {
        let (_, vm, _) = try makeFlashcards(direction: .ruToEs)
        let phrase = try XCTUnwrap(vm.currentPhrase)
        XCTAssertEqual(vm.questionText, phrase.textRu)
        XCTAssertEqual(vm.answerText, phrase.textEs)
        XCTAssertEqual(vm.questionLanguageLabel, "RU")
        XCTAssertEqual(vm.answerLanguageLabel, "ES")
    }

    func testKnownUpdatesSRSAndFinishesWithAccuracy() throws {
        let (env, vm, _) = try makeFlashcards(singleFirst: true)
        let targetId = try XCTUnwrap(vm.currentPhraseId)
        XCTAssertEqual(vm.totalCards, 1)

        vm.reveal()
        XCTAssertTrue(vm.showAnswer)
        vm.markKnown()

        XCTAssertTrue(vm.isFinished)
        XCTAssertEqual(env.sessionFlow.step, .completed)
        let result = try XCTUnwrap(env.sessionFlow.result)
        XCTAssertEqual(result.accuracy, 1.0)
        XCTAssertEqual(result.phrasesCompleted, 1)
        XCTAssertEqual(result.phrasesTotal, 1)

        let phrase = try XCTUnwrap(env.repository.phrase(phraseId: targetId))
        XCTAssertEqual(phrase.reviewCount, 1)
        XCTAssertEqual(phrase.stateEnum, .learning) // 1 < 3, ещё не повышается
        XCTAssertEqual(phrase.statistics?.correctCount, 1)
        XCTAssertEqual(phrase.statistics?.totalReviewCount, 1)
    }

    func testUnknownRequeuesThenKnownGivesZeroAccuracy() throws {
        let (env, vm, _) = try makeFlashcards(singleFirst: true)
        let targetId = try XCTUnwrap(vm.currentPhraseId)

        vm.reveal()
        vm.markUnknown()

        // Карта возвращена в колоду — сессия не завершена.
        XCTAssertFalse(vm.isFinished)
        XCTAssertNil(env.sessionFlow.result)
        XCTAssertEqual(vm.completedCount, 0)
        XCTAssertFalse(vm.showAnswer, "после ответа ответ скрывается")

        let mid = try XCTUnwrap(env.repository.phrase(phraseId: targetId))
        XCTAssertEqual(mid.reviewCount, 1, "«Не знал» тоже +1 к reviewCount")
        XCTAssertEqual(mid.statistics?.correctCount ?? 0, 0)
        XCTAssertEqual(mid.stateEnum, .learning)

        // Теперь «Знал».
        vm.reveal()
        vm.markKnown()

        XCTAssertTrue(vm.isFinished)
        let result = try XCTUnwrap(env.sessionFlow.result)
        XCTAssertEqual(result.accuracy, 0.0, "первый показ был неверным")
        XCTAssertEqual(result.phrasesCompleted, 1, "уникальная карта закрыта один раз")

        let phrase = try XCTUnwrap(env.repository.phrase(phraseId: targetId))
        XCTAssertEqual(phrase.reviewCount, 2, "два ответа = два повтора")
        XCTAssertEqual(phrase.statistics?.correctCount, 1)
    }

    func testTrackProgressOffSkipsSRS() throws {
        let (env, vm, _) = try makeFlashcards(singleFirst: true)
        env.sessionFlow.config.trackProgress = false
        let targetId = try XCTUnwrap(vm.currentPhraseId)
        vm.reveal()
        vm.markKnown()
        let phrase = try XCTUnwrap(env.repository.phrase(phraseId: targetId))
        XCTAssertEqual(phrase.reviewCount, 0, "при выключенном трекинге SRS не трогается")
        XCTAssertNil(phrase.statistics)
    }

    func testSessionRecordedOnFinish() throws {
        let (env, vm, _) = try makeFlashcards(singleFirst: true)
        vm.reveal()
        vm.markKnown()
        let sessions = try env.viewContext.fetch(LearningSession.fetchRequest())
        XCTAssertEqual(sessions.count, 1)
        let session = try XCTUnwrap(sessions.first)
        XCTAssertNotNil(session.completedAt)
        XCTAssertEqual(session.phrasesCount, 1)
        XCTAssertEqual(session.phrasesCompletedCount, 1)
        XCTAssertEqual(session.config?.playbackMode, .flashcards)
        XCTAssertNil(env.activeSessionID, "активная сессия очищена по завершении")
    }
}
