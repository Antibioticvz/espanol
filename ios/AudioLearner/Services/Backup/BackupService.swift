import CoreData
import Foundation

/// Резервное копирование прогресса и настроек (спека §4.9, §12.1).
/// Экспорт состояний фраз/прогресса/настроек в JSON, ротация 7 файлов, восстановление.
final class BackupService {

    private let repository: LessonRepository
    private let defaults: UserDefaults
    private let maxBackups = 7

    init(repository: LessonRepository, defaults: UserDefaults = .standard) {
        self.repository = repository
        self.defaults = defaults
    }

    // MARK: - Codable payload

    struct Payload: Codable {
        var createdAt: Date
        var settings: [String: String]
        var lessons: [LessonBackup]
    }

    struct LessonBackup: Codable {
        var topicId: String
        var titleRu: String
        var phrases: [PhraseBackup]
        var progress: ProgressBackup?
    }

    struct PhraseBackup: Codable {
        var phraseId: String
        var state: String
        var reviewCount: Int
        var lastReviewDate: Date?
        var nextReviewDate: Date?
        var isFavorite: Bool
    }

    struct ProgressBackup: Codable {
        var totalSessionsCompleted: Int
        var totalMinutesLearned: Int
        var totalPhrasesReviewed: Int
        var streakDays: Int
        var bestStreakDays: Int
    }

    // MARK: - Create

    @discardableResult
    func createBackup(settings: [String: String] = [:], now: Date = Date()) throws -> URL {
        let lessons = try repository.allLessons().map { lesson -> LessonBackup in
            let phrases = lesson.allLearnablePhrases.map { phrase in
                PhraseBackup(
                    phraseId: phrase.phraseId,
                    state: phrase.state,
                    reviewCount: Int(phrase.reviewCount),
                    lastReviewDate: phrase.lastReviewDate,
                    nextReviewDate: phrase.nextReviewDate,
                    isFavorite: phrase.isFavorite
                )
            }
            let progress = lesson.progress.map { p in
                ProgressBackup(
                    totalSessionsCompleted: Int(p.totalSessionsCompleted),
                    totalMinutesLearned: Int(p.totalMinutesLearned),
                    totalPhrasesReviewed: Int(p.totalPhrasesReviewed),
                    streakDays: Int(p.streakDays),
                    bestStreakDays: Int(p.bestStreakDays)
                )
            }
            return LessonBackup(topicId: lesson.topicId, titleRu: lesson.titleRu,
                                phrases: phrases, progress: progress)
        }

        let payload = Payload(createdAt: now, settings: settings, lessons: lessons)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(payload)

        AppPaths.ensureDirectories()
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        let url = AppPaths.backupsDirectory
            .appendingPathComponent("backup_\(formatter.string(from: now)).json")
        try data.write(to: url, options: .atomic)

        defaults.set(now, forKey: SettingsKeys.lastBackupDate)
        pruneOldBackups()
        return url
    }

    /// Создаёт бэкап, если сегодня ещё не создавали (для вызова при запуске).
    @discardableResult
    func createDailyBackupIfNeeded(settings: [String: String] = [:], now: Date = Date()) -> URL? {
        if let last = defaults.object(forKey: SettingsKeys.lastBackupDate) as? Date,
           Calendar.current.isDate(last, inSameDayAs: now) {
            return nil
        }
        return try? createBackup(settings: settings, now: now)
    }

    // MARK: - List / size

    func availableBackups() -> [URL] {
        let urls = (try? FileManager.default.contentsOfDirectory(
            at: AppPaths.backupsDirectory,
            includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        return urls
            .filter { $0.pathExtension == "json" }
            .sorted { lhs, rhs in
                let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return l > r
            }
    }

    func totalBackupSize() -> Int {
        availableBackups().reduce(0) { sum, url in
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            return sum + size
        }
    }

    private func pruneOldBackups() {
        let backups = availableBackups()
        guard backups.count > maxBackups else { return }
        for url in backups[maxBackups...] {
            try? FileManager.default.removeItem(at: url)
        }
    }

    // MARK: - Restore

    /// Восстанавливает состояния фраз и агрегаты прогресса из бэкапа
    /// (аудио-файлы не трогаются). Возвращает число обновлённых фраз.
    @discardableResult
    func restore(from url: URL) throws -> Int {
        let data = try Data(contentsOf: url)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let payload = try decoder.decode(Payload.self, from: data)

        var updated = 0
        for lessonBackup in payload.lessons {
            guard let lesson = try repository.lesson(topicId: lessonBackup.topicId) else { continue }
            var byId: [String: Phrase] = [:]
            for phrase in lesson.allLearnablePhrases { byId[phrase.phraseId] = phrase }
            for pb in lessonBackup.phrases {
                guard let phrase = byId[pb.phraseId] else { continue }
                phrase.state = pb.state
                phrase.reviewCount = Int64(pb.reviewCount)
                phrase.lastReviewDate = pb.lastReviewDate
                phrase.nextReviewDate = pb.nextReviewDate
                phrase.isFavorite = pb.isFavorite
                updated += 1
            }
            if let pb = lessonBackup.progress, let progress = lesson.progress {
                progress.totalSessionsCompleted = Int64(pb.totalSessionsCompleted)
                progress.totalMinutesLearned = Int64(pb.totalMinutesLearned)
                progress.totalPhrasesReviewed = Int64(pb.totalPhrasesReviewed)
                progress.streakDays = Int64(pb.streakDays)
                progress.bestStreakDays = Int64(pb.bestStreakDays)
                repository.recomputeProgressCounters(progress, lesson: lesson)
            }
        }
        try repository.context.save()
        return updated
    }
}
