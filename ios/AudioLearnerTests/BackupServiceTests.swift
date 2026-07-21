import CoreData
import XCTest
@testable import AudioLearner

/// Резервное копирование и восстановление, включая статистику фраз (спека §4.9).
final class BackupServiceTests: AudioLearnerTestCase {

    private func makeService() throws -> (BackupService, UserDefaults, String) {
        let suite = "backup-test-\(UUID().uuidString)"
        let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
        return (BackupService(repository: repository, defaults: defaults), defaults, suite)
    }

    func testBackupRestoreRoundtripIncludingStatistics() throws {
        let lesson = try importFixture()
        let targetId = try XCTUnwrap(lesson.allLearnablePhrases.first).phraseId
        let phrase = try XCTUnwrap(repository.phrase(phraseId: targetId))

        // Прогресс + статистика.
        phrase.stateEnum = .mastered
        phrase.reviewCount = 9
        let reviewedAt = Date(timeIntervalSince1970: 1_700_000_000)
        phrase.lastReviewDate = reviewedAt
        let stats = PhraseStatistics(context: context)
        stats.phrase = phrase
        stats.totalReviewCount = 9
        stats.correctCount = 7
        stats.averageReviewTime = 3.5
        stats.lastReviewedAt = reviewedAt
        lesson.progress?.totalSessionsCompleted = 4
        try context.save()

        let (service, defaults, suite) = try makeService()
        defer { defaults.removePersistentDomain(forName: suite) }
        let url = try service.createBackup()

        // Стираем прогресс.
        phrase.stateEnum = .learning
        phrase.reviewCount = 0
        phrase.statistics?.totalReviewCount = 0
        phrase.statistics?.correctCount = 0
        try context.save()

        // Восстанавливаем.
        let restored = try service.restore(from: url)
        XCTAssertGreaterThan(restored, 0)

        let after = try XCTUnwrap(repository.phrase(phraseId: targetId))
        XCTAssertEqual(after.stateEnum, .mastered)
        XCTAssertEqual(after.reviewCount, 9)
        XCTAssertEqual(after.lastReviewDate, reviewedAt)
        let afterStats = try XCTUnwrap(after.statistics)
        XCTAssertEqual(afterStats.totalReviewCount, 9)
        XCTAssertEqual(afterStats.correctCount, 7)
        XCTAssertEqual(afterStats.averageReviewTime, 3.5, accuracy: 0.001)
    }

    func testRotationKeepsSevenNewest() throws {
        _ = try importFixture()
        let (service, defaults, suite) = try makeService()
        defer { defaults.removePersistentDomain(forName: suite) }

        // Создаём 9 бэкапов с разными временными метками (разные имена файлов).
        let base = Date(timeIntervalSince1970: 1_600_000_000)
        for i in 0..<9 {
            _ = try service.createBackup(now: base.addingTimeInterval(Double(i) * 3600))
        }
        XCTAssertLessThanOrEqual(service.availableBackups().count, 7,
                                 "Ротация должна оставлять не более 7 копий")
    }

    func testDailyBackupCreatedOncePerDay() throws {
        _ = try importFixture()
        let (service, defaults, suite) = try makeService()
        defer { defaults.removePersistentDomain(forName: suite) }
        let now = Date()

        XCTAssertNotNil(service.createDailyBackupIfNeeded(now: now))
        // Второй вызов в тот же день — nil.
        XCTAssertNil(service.createDailyBackupIfNeeded(now: now.addingTimeInterval(60)))
    }
}
