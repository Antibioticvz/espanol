import XCTest
@testable import AudioLearner

/// Декодирование lesson.json и проверка версии схемы (D-11).
final class LessonCodableTests: AudioLearnerTestCase {

    /// Извлекает сырой lesson.json из фикстуры (через сервис импорта).
    private func fixtureManifestData() throws -> Data {
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        let jsonURL = prepared.extractedRoot.appendingPathComponent("lesson.json")
        return try Data(contentsOf: jsonURL)
    }

    func testDecodesFixtureManifest() throws {
        let data = try fixtureManifestData()
        let manifest = try LessonManifest.decodeValidating(from: data)

        XCTAssertEqual(manifest.schemaVersion, "1.0")
        XCTAssertEqual(manifest.topicId, "04-hablar-de-mi-mismo")
        XCTAssertEqual(manifest.topicNumber, 4)
        XCTAssertEqual(manifest.titleRu, "Рассказ о себе")
        XCTAssertEqual(manifest.titleEs, "Cuéntame sobre ti")
        XCTAssertEqual(manifest.config.provider, "mock_say")
        XCTAssertEqual(manifest.config.voiceEs.name, "Mónica")

        // Счётчики из stats.
        XCTAssertEqual(manifest.stats.phraseCount, 9)
        XCTAssertEqual(manifest.stats.vocabCount, 4)
        XCTAssertEqual(manifest.stats.storyCount, 1)
        XCTAssertEqual(manifest.stats.totalElements, 14)

        // Структура блоков: 4 блока (verb_group, phrase_group, vocabulary, story).
        XCTAssertEqual(manifest.blocks.count, 4)
        XCTAssertEqual(manifest.allPhrases.count, 9)
        XCTAssertEqual(manifest.allWords.count, 4)
        XCTAssertEqual(manifest.allAudioPairs.count, 14) // 9 + 4 + 1 story

        // Первая фраза декодирована с длительностями.
        let first = try XCTUnwrap(manifest.allPhrases.first)
        XCTAssertEqual(first.id, "04-b1-llamarse-01")
        XCTAssertEqual(first.es, "Me llamo Victor.")
        XCTAssertGreaterThan(first.durationMs.es, 0)
        XCTAssertGreaterThan(first.durationMs.ru, 0)

        // Story-блок декодирован с текстом и аудио, без groups.
        let story = try XCTUnwrap(manifest.blocks.first { $0.blockType == .story })
        XCTAssertNotNil(story.textEs)
        XCTAssertNotNil(story.audio)
        XCTAssertNil(story.groups)
    }

    func testRejectsUnsupportedMajorSchemaVersion() throws {
        let data = try fixtureManifestData()
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        let bumped = json.replacingOccurrences(of: "\"schema_version\": \"1.0\"",
                                               with: "\"schema_version\": \"2.0\"")
        let bumpedData = try XCTUnwrap(bumped.data(using: .utf8))

        XCTAssertThrowsError(try LessonManifest.decodeValidating(from: bumpedData)) { error in
            guard case ImportError.unsupportedSchemaVersion(let version) = error else {
                return XCTFail("Ожидалась ошибка unsupportedSchemaVersion, получено: \(error)")
            }
            XCTAssertEqual(version, "2.0")
        }
    }

    func testAcceptsFutureMinorSchemaVersion() throws {
        // Совместимая minor-версия (1.5) должна декодироваться.
        let data = try fixtureManifestData()
        let json = try XCTUnwrap(String(data: data, encoding: .utf8))
        let bumped = json.replacingOccurrences(of: "\"schema_version\": \"1.0\"",
                                               with: "\"schema_version\": \"1.5\"")
        let bumpedData = try XCTUnwrap(bumped.data(using: .utf8))
        let manifest = try LessonManifest.decodeValidating(from: bumpedData)
        XCTAssertEqual(manifest.schemaVersion, "1.5")
    }
}
