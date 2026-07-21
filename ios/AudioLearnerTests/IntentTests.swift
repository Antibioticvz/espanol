import CoreData
import XCTest
@testable import AudioLearner

/// Санити App Intents (v1.2, D-23): без UI-теста виджета — только логика интента/моста.
@MainActor
final class IntentTests: AudioLearnerTestCase {

    private func makeEnvWithFixture() throws -> AppEnvironment {
        let env = AppEnvironment(inMemory: true)
        let service = FileImportService(repository: env.repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        _ = try service.commit(prepared, resolution: .replace)
        return env
    }

    func testEnvironmentInstallsIntentHandlers() {
        _ = AppEnvironment(inMemory: true)
        XCTAssertNotNil(IntentActionCoordinator.shared.onStartDailySession)
        XCTAssertNotNil(IntentActionCoordinator.shared.onPauseSession)
    }

    func testStartDailyIntentStartsSessionWhenDue() async throws {
        let env = try makeEnvWithFixture() // 13 фраз к повтору
        _ = try await StartDailySessionIntent().perform()
        XCTAssertTrue(env.sessionFlow.isDailySession)
        XCTAssertNil(env.sessionFlow.lesson)
        XCTAssertFalse(env.sessionFlow.orderedSelectedPhrases().isEmpty)
        // C12: интент реально запускает воспроизведение (раннер + плеер настроены), не просто ставит step.
        XCTAssertEqual(env.sessionFlow.step, .player)
        XCTAssertNotNil(env.activeAudioSession)
        XCTAssertFalse(env.sessionFlow.player.phrases.isEmpty)
        // Плеер действительно играет: isPlaying и загруженная длительность > 0 (реальное аудио).
        XCTAssertTrue(env.sessionFlow.player.isPlaying, "аудио стартовало из интента, не ждём view")
        XCTAssertGreaterThan(env.sessionFlow.player.currentDuration, 0, "загружен и играет реальный клип")
        env.endActiveSession(abandoned: true)
    }

    func testStartDailyIntentNothingToReview() async throws {
        let env = AppEnvironment(inMemory: true) // уроков нет
        _ = try await StartDailySessionIntent().perform()
        XCTAssertFalse(env.sessionFlow.isDailySession, "нечего повторять — сессия не стартует")
    }

    func testCoordinatorStartReturnsFalseWhenEmpty() {
        let env = AppEnvironment(inMemory: true)
        _ = env // env устанавливает обработчики
        XCTAssertFalse(IntentActionCoordinator.shared.startDailySession())
    }
}
