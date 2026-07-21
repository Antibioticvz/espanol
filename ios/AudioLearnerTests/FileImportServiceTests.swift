import CoreData
import XCTest
@testable import AudioLearner

/// Импорт фикстуры: распаковка → валидация → индексация в CoreData.
final class FileImportServiceTests: AudioLearnerTestCase {

    func testImportIndexesCorrectCounts() throws {
        let lesson = try importFixture()

        // 9 фраз (verb_group + phrase_group), 4 слова (vocabulary), 1 рассказ (story).
        XCTAssertEqual(lesson.phrases.count, 9, "Ожидалось 9 фраз")
        XCTAssertEqual(lesson.words.count, 4, "Ожидалось 4 слова")
        XCTAssertEqual(lesson.storyBlocks.count, 1, "Ожидался 1 рассказ")

        // 28 аудио-файлов: (9 + 4 + 1) элементов × 2 языка.
        XCTAssertEqual(lesson.audioFiles.count, 28, "Ожидалось 28 аудио-файлов")

        // Кэшированные счётчики совпадают со stats.
        XCTAssertEqual(lesson.phraseCount, 9)
        XCTAssertEqual(lesson.vocabCount, 4)
        XCTAssertEqual(lesson.storyCount, 1)

        // Структура блоков.
        XCTAssertEqual(lesson.orderedBlocks.count, 4)
        XCTAssertEqual(lesson.orderedBlocks.map(\.type),
                       ["verb_group", "phrase_group", "vocabulary", "story"])
    }

    func testImportedAudioFilesExistWithPositiveDuration() throws {
        let lesson = try importFixture()

        for audio in lesson.audioFiles {
            XCTAssertTrue(FileManager.default.fileExists(atPath: audio.fileURL.path),
                          "Аудио-файл не найден на диске: \(audio.relativePath)")
            XCTAssertGreaterThan(audio.durationMs, 0,
                                 "Длительность должна быть > 0 для \(audio.fileId)")
            XCTAssertGreaterThan(audio.fileSize, 0,
                                 "Размер файла должен быть > 0 для \(audio.fileId)")
        }
    }

    func testEveryPhraseHasEsAndRuAudio() throws {
        let lesson = try importFixture()
        for phrase in lesson.allLearnablePhrases {
            XCTAssertNotNil(phrase.audioEs, "Нет ES-аудио для \(phrase.phraseId)")
            XCTAssertNotNil(phrase.audioRu, "Нет RU-аудио для \(phrase.phraseId)")
            XCTAssertGreaterThan(phrase.durationSeconds, 0)
        }
    }

    func testGroupsAndTranslations() throws {
        let lesson = try importFixture()
        let verbBlock = try XCTUnwrap(lesson.orderedBlocks.first { $0.blockTypeEnum == .verbGroup })
        XCTAssertEqual(verbBlock.orderedGroups.count, 2) // llamarse, tener
        let llamarse = try XCTUnwrap(verbBlock.orderedGroups.first { $0.key == "llamarse" })
        XCTAssertEqual(llamarse.translationRu, "зваться")
        XCTAssertEqual(llamarse.orderedPhrases.count, 3)
    }

    func testProgressInitializedAllLearning() throws {
        let lesson = try importFixture()
        let progress = try XCTUnwrap(lesson.progress)
        XCTAssertEqual(progress.phrasesLearning, 13) // 9 фраз + 4 слова
        XCTAssertEqual(progress.phrasesInProgress, 0)
        XCTAssertEqual(progress.phrasesMastered, 0)
    }

    func testNewLessonHasNoConflict() throws {
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        XCTAssertFalse(prepared.hasConflict)
        _ = try service.commit(prepared, resolution: .replace)

        // Повторная подготовка теперь видит конфликт.
        let prepared2 = try service.prepare(zipURL: try TestSupport.fixtureURL())
        XCTAssertTrue(prepared2.hasConflict)
    }

    /// Сбой копирования на середине (перед атомарной подменой) не должен ломать существующий урок.
    func testAtomicImportFailureKeepsOldLessonIntact() throws {
        let lesson = try importFixture()
        let targetId = try XCTUnwrap(lesson.allLearnablePhrases.first).phraseId

        // Прогрессируем фразу и запоминаем пути аудио.
        let phrase = try XCTUnwrap(repository.phrase(phraseId: targetId))
        phrase.stateEnum = .inProgress
        phrase.reviewCount = 7
        try context.save()
        let audioPaths = lesson.audioFiles.map(\.fileURL)
        for url in audioPaths {
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path))
        }

        // Повторный импорт с искусственным сбоем ровно перед подменой каталога.
        let service = FileImportService(repository: repository)
        service.beforeSwapHook = { throw ImportError.copyFailed("simulated failure") }
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        XCTAssertThrowsError(try service.commit(prepared, resolution: .update)) { error in
            guard case ImportError.copyFailed = error else {
                return XCTFail("Ожидалась copyFailed, получено: \(error)")
            }
        }

        // Существующий урок цел: 1 урок, 9 фраз, 28 аудио, файлы на месте, прогресс сохранён.
        XCTAssertEqual(try repository.allLessons().count, 1)
        let after = try XCTUnwrap(repository.lesson(topicId: "04-hablar-de-mi-mismo"))
        XCTAssertEqual(after.phrases.count, 9)
        XCTAssertEqual(after.audioFiles.count, 28)
        for url in after.audioFiles.map(\.fileURL) {
            XCTAssertTrue(FileManager.default.fileExists(atPath: url.path),
                          "Аудио старого урока должно остаться на диске")
        }
        let phraseAfter = try XCTUnwrap(repository.phrase(phraseId: targetId))
        XCTAssertEqual(phraseAfter.stateEnum, .inProgress)
        XCTAssertEqual(phraseAfter.reviewCount, 7)

        // Не осталось staging-каталогов.
        let leftovers = (try? FileManager.default.contentsOfDirectory(
            at: AppPaths.lessonsDirectory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertFalse(leftovers.contains { $0.lastPathComponent.hasPrefix(".staging-") })
    }

    /// Ошибка распаковки/валидации в prepare() убирает временную папку.
    func testPrepareCleansTempOnError() throws {
        // Невалидный «ZIP» → unzip падает → cannotOpenArchive.
        let badZip = FileManager.default.temporaryDirectory
            .appendingPathComponent("\(UUID().uuidString).zip")
        try Data("not a real zip".utf8).write(to: badZip)
        defer { try? FileManager.default.removeItem(at: badZip) }

        let service = FileImportService(repository: repository)
        XCTAssertThrowsError(try service.prepare(zipURL: badZip))

        let temps = (try? FileManager.default.contentsOfDirectory(
            at: AppPaths.tempImportsDirectory, includingPropertiesForKeys: nil)) ?? []
        XCTAssertTrue(temps.isEmpty, "Временная папка должна быть удалена после ошибки")
    }
}
