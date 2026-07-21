import CoreData
import Foundation

/// Пути в песочнице приложения (спека §12.1).
enum AppPaths {
    /// Позволяет тестам подменить каталог Documents на временный (изоляция).
    static var overrideDocumentsURL: URL?

    static var documentsURL: URL {
        overrideDocumentsURL ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }
    static var appRoot: URL { documentsURL.appendingPathComponent("AudioLearner", isDirectory: true) }
    static var lessonsDirectory: URL { appRoot.appendingPathComponent("lessons", isDirectory: true) }
    static var backupsDirectory: URL { appRoot.appendingPathComponent("backups", isDirectory: true) }
    static var exportsDirectory: URL { appRoot.appendingPathComponent("exports", isDirectory: true) }
    static var tempImportsDirectory: URL { appRoot.appendingPathComponent("temp_imports", isDirectory: true) }

    /// Создаёт стандартные каталоги приложения, если их нет.
    static func ensureDirectories() {
        for dir in [lessonsDirectory, backupsDirectory, exportsDirectory, tempImportsDirectory] {
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        }
    }
}

/// Программная модель CoreData (D-07: без .xcdatamodeld) и контейнер.
final class PersistenceController {
    static let shared = PersistenceController()

    let container: NSPersistentContainer

    var viewContext: NSManagedObjectContext { container.viewContext }

    /// Единая модель на процесс: несколько NSManagedObjectModel с одними и теми же
    /// классами сущностей ломают резолвинг `+entity`. Кэшируем один экземпляр.
    static let sharedModel: NSManagedObjectModel = makeModel()

    /// - Parameter inMemory: true для тестов (SQLite на /dev/null, ничего не пишется на диск).
    init(inMemory: Bool = false) {
        container = NSPersistentContainer(name: "AudioLearner", managedObjectModel: PersistenceController.sharedModel)

        if inMemory {
            // SQLite-хранилище на /dev/null: полноценный стек, но ничего не пишется на диск.
            let description = NSPersistentStoreDescription(url: URL(fileURLWithPath: "/dev/null"))
            description.shouldAddStoreAsynchronously = false
            container.persistentStoreDescriptions = [description]
        } else {
            AppPaths.ensureDirectories()
            let supportDir = FileManager.default
                .urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("AudioLearner", isDirectory: true)
            try? FileManager.default.createDirectory(at: supportDir, withIntermediateDirectories: true)
            let storeURL = supportDir.appendingPathComponent("AudioLearner.sqlite")
            let description = NSPersistentStoreDescription(url: storeURL)
            description.shouldMigrateStoreAutomatically = true
            description.shouldInferMappingModelAutomatically = true
            container.persistentStoreDescriptions = [description]
        }

        container.loadPersistentStores { _, error in
            if let error {
                assertionFailure("CoreData store load failed: \(error)")
            }
        }
        container.viewContext.automaticallyMergesChangesFromParent = true
        container.viewContext.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
    }

    func newBackgroundContext() -> NSManagedObjectContext {
        let ctx = container.newBackgroundContext()
        ctx.mergePolicy = NSMergeByPropertyObjectTrumpMergePolicy
        return ctx
    }

    // MARK: - Model construction

    static func makeModel() -> NSManagedObjectModel {
        let model = NSManagedObjectModel()

        // Entities
        let lesson = entity("Lesson")
        let block = entity("LessonBlock")
        let group = entity("PhraseGroup")
        let phrase = entity("Phrase")
        let audio = entity("AudioFile")
        let progress = entity("LessonProgress")
        let session = entity("LearningSession")
        let phraseStats = entity("PhraseStatistics")
        let stateUpdate = entity("PhraseStateUpdate")

        // MARK: Attributes

        lesson.properties = [
            attr("topicId", .stringAttributeType),
            attr("topicNumber", .integer64AttributeType, defaultValue: 0),
            attr("titleRu", .stringAttributeType, defaultValue: ""),
            attr("titleEs", .stringAttributeType, optional: true),
            attr("createdAt", .dateAttributeType),
            attr("importedAt", .dateAttributeType),
            attr("generatorVersion", .stringAttributeType, defaultValue: ""),
            attr("schemaVersion", .stringAttributeType, defaultValue: "1.0"),
            attr("phraseCount", .integer64AttributeType, defaultValue: 0),
            attr("vocabCount", .integer64AttributeType, defaultValue: 0),
            attr("storyCount", .integer64AttributeType, defaultValue: 0),
            attr("characterCountEs", .integer64AttributeType, defaultValue: 0),
            attr("characterCountRu", .integer64AttributeType, defaultValue: 0)
        ]

        block.properties = [
            attr("blockId", .stringAttributeType),
            attr("type", .stringAttributeType, defaultValue: "phrase_group"),
            attr("titleRu", .stringAttributeType, defaultValue: ""),
            attr("titleEs", .stringAttributeType, optional: true),
            attr("orderIndex", .integer64AttributeType, defaultValue: 0),
            attr("textEs", .stringAttributeType, optional: true),
            attr("textRu", .stringAttributeType, optional: true),
            attr("splitByPhrase", .booleanAttributeType, defaultValue: false)
        ]

        group.properties = [
            attr("key", .stringAttributeType, defaultValue: ""),
            attr("titleRu", .stringAttributeType, optional: true),
            attr("translationRu", .stringAttributeType, optional: true),
            attr("orderIndex", .integer64AttributeType, defaultValue: 0)
        ]

        phrase.properties = [
            attr("phraseId", .stringAttributeType),
            attr("textEs", .stringAttributeType, defaultValue: ""),
            attr("textRu", .stringAttributeType, defaultValue: ""),
            attr("orderIndex", .integer64AttributeType, defaultValue: 0),
            attr("state", .stringAttributeType, defaultValue: PhraseState.learning.rawValue),
            attr("lastReviewDate", .dateAttributeType, optional: true),
            attr("reviewCount", .integer64AttributeType, defaultValue: 0),
            attr("nextReviewDate", .dateAttributeType, optional: true),
            attr("easeFactor", .doubleAttributeType, defaultValue: 2.5),
            attr("interval", .integer64AttributeType, defaultValue: 1),
            attr("isFavorite", .booleanAttributeType, defaultValue: false)
        ]

        audio.properties = [
            attr("fileId", .stringAttributeType, defaultValue: ""),
            attr("language", .stringAttributeType, defaultValue: "es"),
            attr("relativePath", .stringAttributeType, defaultValue: ""),
            attr("durationMs", .integer64AttributeType, defaultValue: 0),
            attr("fileSize", .integer64AttributeType, defaultValue: 0),
            attr("isDownloaded", .booleanAttributeType, defaultValue: true)
        ]

        progress.properties = [
            attr("phrasesLearning", .integer64AttributeType, defaultValue: 0),
            attr("phrasesInProgress", .integer64AttributeType, defaultValue: 0),
            attr("phrasesMastered", .integer64AttributeType, defaultValue: 0),
            attr("totalSessionsCompleted", .integer64AttributeType, defaultValue: 0),
            attr("totalMinutesLearned", .integer64AttributeType, defaultValue: 0),
            attr("totalPhrasesReviewed", .integer64AttributeType, defaultValue: 0),
            attr("streakDays", .integer64AttributeType, defaultValue: 0),
            attr("bestStreakDays", .integer64AttributeType, defaultValue: 0),
            attr("lastAccessedAt", .dateAttributeType, optional: true),
            attr("lastCompletedSessionAt", .dateAttributeType, optional: true)
        ]

        session.properties = [
            attr("sessionId", .UUIDAttributeType),
            attr("startedAt", .dateAttributeType),
            attr("completedAt", .dateAttributeType, optional: true),
            attr("configData", .binaryDataAttributeType, defaultValue: Data()),
            attr("phrasesCount", .integer64AttributeType, defaultValue: 0),
            attr("phrasesRepeats", .integer64AttributeType, defaultValue: 0),
            attr("actualDurationSeconds", .integer64AttributeType, defaultValue: 0),
            attr("phrasesCompletedCount", .integer64AttributeType, defaultValue: 0),
            attr("speed", .doubleAttributeType, defaultValue: 1.0)
        ]

        phraseStats.properties = [
            attr("correctCount", .integer64AttributeType, defaultValue: 0),
            attr("totalReviewCount", .integer64AttributeType, defaultValue: 0),
            attr("lastReviewedAt", .dateAttributeType, optional: true),
            attr("averageReviewTime", .doubleAttributeType, defaultValue: 0)
        ]

        stateUpdate.properties = [
            attr("phraseId", .stringAttributeType, defaultValue: ""),
            attr("oldState", .stringAttributeType, defaultValue: ""),
            attr("newState", .stringAttributeType, defaultValue: ""),
            attr("updatedAt", .dateAttributeType)
        ]

        // MARK: Relationships (each with an inverse)

        pair(
            (lesson, "blocks", block, toMany: true, .cascadeDeleteRule),
            (block, "lesson", lesson, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (lesson, "progress", progress, toMany: false, .cascadeDeleteRule),
            (progress, "lesson", lesson, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (lesson, "sessions", session, toMany: true, .cascadeDeleteRule),
            (session, "lesson", lesson, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (lesson, "audioFiles", audio, toMany: true, .cascadeDeleteRule),
            (audio, "lesson", lesson, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (lesson, "phrasesRel", phrase, toMany: true, .cascadeDeleteRule),
            (phrase, "lesson", lesson, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (block, "groups", group, toMany: true, .cascadeDeleteRule),
            (group, "block", block, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (block, "phrases", phrase, toMany: true, .nullifyDeleteRule),
            (phrase, "block", block, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (block, "audioFiles", audio, toMany: true, .nullifyDeleteRule),
            (audio, "block", block, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (group, "phrases", phrase, toMany: true, .nullifyDeleteRule),
            (phrase, "group", group, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (phrase, "statistics", phraseStats, toMany: false, .cascadeDeleteRule),
            (phraseStats, "phrase", phrase, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (phrase, "audioFiles", audio, toMany: true, .nullifyDeleteRule),
            (audio, "phrase", phrase, toMany: false, .nullifyDeleteRule)
        )
        pair(
            (session, "phraseUpdates", stateUpdate, toMany: true, .cascadeDeleteRule),
            (stateUpdate, "session", session, toMany: false, .nullifyDeleteRule)
        )

        model.entities = [lesson, block, group, phrase, audio, progress, session, phraseStats, stateUpdate]
        return model
    }

    // MARK: - Builders

    private static func entity(_ name: String) -> NSEntityDescription {
        let e = NSEntityDescription()
        e.name = name
        e.managedObjectClassName = name
        return e
    }

    private static func attr(
        _ name: String,
        _ type: NSAttributeType,
        optional: Bool = false,
        defaultValue: Any? = nil
    ) -> NSAttributeDescription {
        let a = NSAttributeDescription()
        a.name = name
        a.attributeType = type
        a.isOptional = optional
        if let defaultValue { a.defaultValue = defaultValue }
        return a
    }

    private typealias RelSpec = (
        entity: NSEntityDescription,
        name: String,
        destination: NSEntityDescription,
        toMany: Bool,
        deleteRule: NSDeleteRule
    )

    private static func pair(_ a: RelSpec, _ b: RelSpec) {
        let relA = makeRelationship(a)
        let relB = makeRelationship(b)
        relA.inverseRelationship = relB
        relB.inverseRelationship = relA
        a.entity.properties.append(relA)
        b.entity.properties.append(relB)
    }

    private static func makeRelationship(_ spec: RelSpec) -> NSRelationshipDescription {
        let r = NSRelationshipDescription()
        r.name = spec.name
        r.destinationEntity = spec.destination
        r.deleteRule = spec.deleteRule
        r.minCount = 0
        r.maxCount = spec.toMany ? 0 : 1
        r.isOptional = true
        return r
    }
}
