import CoreData
import XCTest
@testable import AudioLearner

/// Регрессии по финальному ревью (ios/**) — v1.2.
@MainActor
final class ReviewFixesTests: AudioLearnerTestCase {

    private func importFixture(into env: AppEnvironment) throws -> Lesson {
        let service = FileImportService(repository: env.repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        return try XCTUnwrap(try service.commit(prepared, resolution: .replace))
    }

    // C17: в cycleSession SRS-регистрация происходит один раз на фразу за сессию (не задваивается).
    func testCycleSessionRegistersSRSOncePerPhrase() throws {
        let lesson = try importFixture()
        let phrases = Array(lesson.allLearnablePhrases.prefix(2)).compactMap { PlayablePhrase(phrase: $0) }
        XCTAssertEqual(phrases.count, 2)

        let player = SessionPlayerService()
        var counts: [String: Int] = [:]
        player.onPhraseCompleted = { id in counts[id, default: 0] += 1 }

        var config = SessionConfig.default
        config.playbackMode = .cycleSession
        config.sessionCycles = 2
        config.repetitions = 1
        player.configure(phrases: phrases, config: config)

        // Прогоняем 2 фразы × 2 цикла через skip (без реального воспроизведения).
        for _ in 0..<4 { player.skipToNextPhrase() }

        XCTAssertEqual(counts[phrases[0].phraseId], 1, "каждая фраза регистрируется в SRS один раз за сессию")
        XCTAssertEqual(counts[phrases[1].phraseId], 1)
    }

    // C21/m14: play/pause вызывают onPlaybackStateChanged (синхронизация Now Playing/Live Activity).
    func testPauseFiresPlaybackStateChanged() {
        let player = SessionPlayerService()
        var fired = 0
        player.onPlaybackStateChanged = { fired += 1 }
        player.pause()
        XCTAssertGreaterThanOrEqual(fired, 1)
    }

    // C13 (структурно): старт новой сессии гасит прежний раннер (не осиротевает).
    func testStartingNewSessionEndsPreviousRunner() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        XCTAssertTrue(env.startDailySession())
        XCTAssertNotNil(env.activeAudioSession)

        env.startSession(for: lesson) // endActiveSession гасит прежнюю
        XCTAssertNil(env.activeAudioSession)
        XCTAssertNil(env.activeSessionID)
        XCTAssertFalse(env.sessionFlow.isDailySession)
    }

    // C16: завершение «Сессии дня» пересчитывает прогресс родных уроков.
    func testDailyFinishRecomputesNativeLessonProgress() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        XCTAssertTrue(env.startDailySession())
        let runner = try XCTUnwrap(env.activeAudioSession)

        // Симулируем повышение статуса фразы во время сессии.
        let phrase = try XCTUnwrap(lesson.allLearnablePhrases.first)
        phrase.stateEnum = .inProgress
        try env.viewContext.save()
        XCTAssertEqual(lesson.progress?.phrasesInProgress, 0, "счётчик ещё устарел")

        runner.finish()

        XCTAssertEqual(lesson.progress?.phrasesInProgress, 1, "после daily-финиша прогресс родного урока пересчитан")
        env.endActiveSession(abandoned: false)
    }

    // C22: виджет обнуляет вчерашние minutes/sessions, сохраняя streak.
    func testWidgetStoreZeroesStaleDay() {
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now)!
        WidgetSharedStore.write(.init(date: yesterday, minutes: 45, sessions: 2, streak: 5))

        let normalized = WidgetSharedStore.readNormalized(now: now)
        XCTAssertEqual(normalized.minutes, 0)
        XCTAssertEqual(normalized.sessions, 0)
        XCTAssertEqual(normalized.streak, 5, "streak сохраняется")

        // За сегодня — не обнуляется.
        WidgetSharedStore.write(.init(date: now, minutes: 30, sessions: 1, streak: 5))
        let today = WidgetSharedStore.readNormalized(now: now)
        XCTAssertEqual(today.minutes, 30)
        XCTAssertEqual(today.sessions, 1)
    }

    // C14: гард удаления урока покрывает «Сессию дня» (обнаружение пересечения фраз).
    func testDeletingLessonInDailySessionIsGuarded() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        XCTAssertTrue(env.startDailySession())
        // Фразы урока пересекаются с выбранными в daily-сессии.
        let lessonIds = Set(lesson.allLearnablePhrases.map(\.phraseId))
        let overlap = env.sessionFlow.selectedPhraseIds.contains { lessonIds.contains($0) }
        XCTAssertTrue(overlap, "фразы урока участвуют в «Сессии дня»")

        // Как в performDelete: гасим сессию, затем удаляем — без крэша.
        env.endActiveSession(abandoned: true)
        env.sessionFlow.reset()
        XCTAssertNoThrow(try env.repository.delete(lesson))
        XCTAssertNil(env.activeAudioSession)
    }
}
