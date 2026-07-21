import CoreData
import XCTest
@testable import AudioLearner

/// Регрессии по критическим находкам state-машины сессии (кросс-ревью, волна 2).
@MainActor
final class SessionLifecycleTests: AudioLearnerTestCase {

    /// Импортирует фикстуру в переданный AppEnvironment и возвращает урок.
    private func importFixture(into env: AppEnvironment) throws -> Lesson {
        let service = FileImportService(repository: env.repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        return try XCTUnwrap(try service.commit(prepared, resolution: .replace))
    }

    private func playables(_ lesson: Lesson) -> [PlayablePhrase] {
        lesson.allLearnablePhrases.compactMap { PlayablePhrase(phrase: $0) }
    }

    // CRITICAL 1: старт новой сессии сбрасывает активный плеер.
    func testBeginResetsActivePlayer() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        let player = env.sessionFlow.player

        player.configure(phrases: playables(lesson), config: .default)
        player.nextPhrase() // сдвигаем индекс без воспроизведения (autoplay=false)
        XCTAssertEqual(player.currentPhraseIndex, 1)

        env.startSession(for: lesson)
        XCTAssertEqual(player.currentPhraseIndex, 0, "begin должен сбросить плеер")
        XCTAssertFalse(player.isPlaying)
        XCTAssertEqual(env.sessionFlow.step, .selectPhrases)
    }

    // CRITICAL 3: удаление урока идущей сессии не крэшит и гасит сессию.
    func testDeletingPlayingLessonIsSafe() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        env.startSession(for: lesson)

        // Имитируем незавершённую сессию.
        let session = LearningSession(context: env.viewContext)
        session.sessionId = UUID()
        session.startedAt = Date()
        session.lesson = lesson
        try env.viewContext.save()
        env.activeSessionID = session.objectID

        // Как в LessonListView.performDelete: сперва гасим сессию урока.
        if env.sessionFlow.lesson?.objectID == lesson.objectID {
            env.endActiveSession(abandoned: true)
            env.sessionFlow.reset()
        }
        XCTAssertNoThrow(try env.repository.delete(lesson))

        XCTAssertEqual(try env.repository.allLessons().count, 0)
        XCTAssertNil(env.activeSessionID)
        XCTAssertNil(env.sessionFlow.lesson)
        XCTAssertFalse(env.sessionFlow.player.isPlaying)
        // Брошенная незавершённая сессия удалена.
        XCTAssertEqual(try env.viewContext.fetch(LearningSession.fetchRequest()).count, 0)
    }

    // CRITICAL 4: toggle переключает play↔pause (а не только play).
    func testTogglePlayPauseFlipsState() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)
        let player = env.sessionFlow.player
        player.configure(phrases: playables(lesson), config: .default)

        XCTAssertFalse(player.isPlaying)
        player.togglePlayPause()
        XCTAssertTrue(player.isPlaying, "первый toggle → play")
        player.togglePlayPause()
        XCTAssertFalse(player.isPlaying, "второй toggle → pause")
        player.reset()
    }

    // MINOR 11: завершение без единой фразы — отмена (сессия не засчитывается).
    func testCleanupOrphanSessionsRemovesUnfinished() throws {
        let env = AppEnvironment(inMemory: true)
        let lesson = try importFixture(into: env)

        let unfinished = LearningSession(context: env.viewContext)
        unfinished.sessionId = UUID()
        unfinished.startedAt = Date()
        unfinished.lesson = lesson
        let finished = LearningSession(context: env.viewContext)
        finished.sessionId = UUID()
        finished.startedAt = Date()
        finished.completedAt = Date()
        finished.lesson = lesson
        try env.viewContext.save()

        env.cleanupOrphanSessions()
        let remaining = try env.viewContext.fetch(LearningSession.fetchRequest())
        XCTAssertEqual(remaining.count, 1)
        XCTAssertNotNil(remaining.first?.completedAt, "остаётся только завершённая сессия")
    }
}
