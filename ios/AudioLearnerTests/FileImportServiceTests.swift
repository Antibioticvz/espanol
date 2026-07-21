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
}
