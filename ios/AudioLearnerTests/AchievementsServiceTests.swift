import XCTest
@testable import AudioLearner

/// Пороги достижений и логика разблокировки (спека §10.2).
final class AchievementsServiceTests: XCTestCase {

    private func context(
        completed: Int = 0,
        streak: Int = 0,
        maxSpeed: Int = 0,
        night: Int = 0,
        mastered: Bool = false
    ) -> AchievementContext {
        AchievementContext(
            completedSessions: completed,
            currentStreak: streak,
            sessionsAtMaxSpeed: maxSpeed,
            nightSessions: night,
            anyLessonFullyMastered: mastered
        )
    }

    func testFirstSessionThreshold() {
        XCTAssertFalse(AchievementsService.satisfied(in: context(completed: 0)).contains(.firstSession))
        XCTAssertTrue(AchievementsService.satisfied(in: context(completed: 1)).contains(.firstSession))
    }

    func testHundredSessionsThreshold() {
        XCTAssertFalse(AchievementsService.satisfied(in: context(completed: 99)).contains(.hundredSessions))
        XCTAssertTrue(AchievementsService.satisfied(in: context(completed: 100)).contains(.hundredSessions))
    }

    func testStreakThresholds() {
        XCTAssertFalse(AchievementsService.satisfied(in: context(streak: 6)).contains(.weekWarrior))
        XCTAssertTrue(AchievementsService.satisfied(in: context(streak: 7)).contains(.weekWarrior))
        XCTAssertFalse(AchievementsService.satisfied(in: context(streak: 29)).contains(.monthMarathon))
        XCTAssertTrue(AchievementsService.satisfied(in: context(streak: 30)).contains(.monthMarathon))
    }

    func testSpeedNightAndMastered() {
        XCTAssertFalse(AchievementsService.satisfied(in: context(maxSpeed: 9)).contains(.speedDemon))
        XCTAssertTrue(AchievementsService.satisfied(in: context(maxSpeed: 10)).contains(.speedDemon))
        XCTAssertFalse(AchievementsService.satisfied(in: context(night: 4)).contains(.nightOwl))
        XCTAssertTrue(AchievementsService.satisfied(in: context(night: 5)).contains(.nightOwl))
        XCTAssertTrue(AchievementsService.satisfied(in: context(mastered: true)).contains(.allMastered))
    }

    func testEvaluateUnlocksOnlyNewOnes() throws {
        let suite = "achievements-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let service = AchievementsService(defaults: defaults)

        let first = service.evaluate(context: context(completed: 1))
        XCTAssertEqual(first, [.firstSession])
        XCTAssertTrue(service.isUnlocked(.firstSession))

        // Повторная проверка того же контекста ничего нового не даёт.
        let again = service.evaluate(context: context(completed: 1))
        XCTAssertTrue(again.isEmpty)

        // Новое достижение разблокируется поверх существующих.
        let streakUnlock = service.evaluate(context: context(completed: 1, streak: 7))
        XCTAssertEqual(streakUnlock, [.weekWarrior])
    }
}
