import Foundation

/// Codable-модели, зеркалящие `shared/lesson.schema.json`.
/// Это контракт между Combine (генератор) и Audio Learner (iOS).
/// Декодируются из `lesson.json` внутри импортируемого ZIP.

// MARK: - Root

struct LessonManifest: Codable {
    let schemaVersion: String
    let topicId: String
    let topicNumber: Int
    let titleRu: String
    let titleEs: String?
    let createdAt: Date
    let generatorVersion: String
    let config: ManifestConfig
    let stats: ManifestStats
    let blocks: [ManifestBlock]

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case topicId = "topic_id"
        case topicNumber = "topic_number"
        case titleRu = "title_ru"
        case titleEs = "title_es"
        case createdAt = "created_at"
        case generatorVersion = "generator_version"
        case config, stats, blocks
    }

    /// Major-компонент версии схемы (например "1.0" -> 1).
    var schemaMajorVersion: Int? {
        Int(schemaVersion.split(separator: ".").first.map(String.init) ?? "")
    }

    /// Поддерживаемая приложением major-версия схемы (D-11: сейчас 1).
    static let supportedSchemaMajor = 1

    /// Все фразы урока (verb_group + phrase_group), без vocabulary/story.
    var allPhrases: [ManifestPhrase] {
        blocks.filter { $0.blockType?.hasGroups == true }
            .flatMap { $0.groups ?? [] }
            .flatMap { $0.phrases }
    }

    /// Все словарные слова (vocabulary).
    var allWords: [ManifestPhrase] {
        blocks.filter { $0.blockType == .vocabulary }
            .flatMap { $0.words ?? [] }
    }

    /// Все аудио-пары урока: фразы + слова + рассказы.
    var allAudioPairs: [ManifestAudioPair] {
        var result: [ManifestAudioPair] = []
        result.append(contentsOf: allPhrases.map(\.audio))
        result.append(contentsOf: allWords.map(\.audio))
        result.append(contentsOf: blocks.compactMap { $0.audio })
        return result
    }
}

// MARK: - Config

struct ManifestConfig: Codable {
    let provider: String
    let model: String
    let voiceEs: ManifestVoice
    let voiceRu: ManifestVoice
    let stability: Double?
    let similarityBoost: Double?
    let seed: Int?

    enum CodingKeys: String, CodingKey {
        case provider, model
        case voiceEs = "voice_es"
        case voiceRu = "voice_ru"
        case stability
        case similarityBoost = "similarity_boost"
        case seed
    }
}

struct ManifestVoice: Codable {
    let id: String
    let name: String
}

// MARK: - Stats

struct ManifestStats: Codable {
    let phraseCount: Int
    let vocabCount: Int
    let storyCount: Int
    let totalElements: Int
    let charactersEs: Int
    let charactersRu: Int
    let totalCharacters: Int
    let estimatedCostUsd: Double?
    let actualCostUsd: Double?
    let generationDurationSeconds: Double?
    let fileSizeMb: Double?

    enum CodingKeys: String, CodingKey {
        case phraseCount = "phrase_count"
        case vocabCount = "vocab_count"
        case storyCount = "story_count"
        case totalElements = "total_elements"
        case charactersEs = "characters_es"
        case charactersRu = "characters_ru"
        case totalCharacters = "total_characters"
        case estimatedCostUsd = "estimated_cost_usd"
        case actualCostUsd = "actual_cost_usd"
        case generationDurationSeconds = "generation_duration_seconds"
        case fileSizeMb = "file_size_mb"
    }
}

// MARK: - Blocks

struct ManifestBlock: Codable {
    let blockId: String
    let type: String
    let titleRu: String
    let titleEs: String?
    let orderIndex: Int
    // verb_group / phrase_group
    let groups: [ManifestGroup]?
    // vocabulary
    let words: [ManifestPhrase]?
    // story
    let textEs: String?
    let textRu: String?
    let audio: ManifestAudioPair?
    let durationMs: ManifestDurationPair?
    let splitByPhrase: Bool?
    let status: String?

    enum CodingKeys: String, CodingKey {
        case blockId = "block_id"
        case type
        case titleRu = "title_ru"
        case titleEs = "title_es"
        case orderIndex = "order_index"
        case groups, words
        case textEs = "text_es"
        case textRu = "text_ru"
        case audio
        case durationMs = "duration_ms"
        case splitByPhrase = "split_by_phrase"
        case status
    }

    var blockType: LessonBlockType? { LessonBlockType(rawValue: type) }
}

struct ManifestGroup: Codable {
    let key: String
    let titleRu: String?
    let translationRu: String?
    let orderIndex: Int
    let phrases: [ManifestPhrase]

    enum CodingKeys: String, CodingKey {
        case key
        case titleRu = "title_ru"
        case translationRu = "translation_ru"
        case orderIndex = "order_index"
        case phrases
    }
}

struct ManifestPhrase: Codable {
    let id: String
    let es: String
    let ru: String
    let audio: ManifestAudioPair
    let durationMs: ManifestDurationPair
    let status: String
    let id3TagsWritten: Bool?
    let generatedAt: Date?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case id, es, ru, audio
        case durationMs = "duration_ms"
        case status
        case id3TagsWritten = "id3_tags_written"
        case generatedAt = "generated_at"
        case error
    }
}

struct ManifestAudioPair: Codable {
    let es: String
    let ru: String
}

struct ManifestDurationPair: Codable {
    let es: Int
    let ru: Int
}

// MARK: - Decoding helper

extension LessonManifest {
    /// Декодер, настроенный под формат lesson.json (ISO-8601 даты).
    static func decoder() -> JSONDecoder {
        let decoder = JSONDecoder()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime]
        let isoFractional = ISO8601DateFormatter()
        isoFractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let string = try container.decode(String.self)
            if let date = iso.date(from: string) ?? isoFractional.date(from: string) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Некорректная дата: \(string)"
            )
        }
        return decoder
    }

    /// Декодирует и проверяет совместимость версии схемы.
    static func decodeValidating(from data: Data) throws -> LessonManifest {
        let manifest: LessonManifest
        do {
            manifest = try decoder().decode(LessonManifest.self, from: data)
        } catch {
            throw ImportError.invalidJSON(error.localizedDescription)
        }
        guard let major = manifest.schemaMajorVersion, major == supportedSchemaMajor else {
            throw ImportError.unsupportedSchemaVersion(manifest.schemaVersion)
        }
        return manifest
    }
}
