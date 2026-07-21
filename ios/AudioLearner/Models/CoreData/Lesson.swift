import CoreData

@objc(Lesson)
public final class Lesson: NSManagedObject {
    @NSManaged public var topicId: String
    @NSManaged public var topicNumber: Int64
    @NSManaged public var titleRu: String
    @NSManaged public var titleEs: String?
    @NSManaged public var createdAt: Date
    @NSManaged public var importedAt: Date
    @NSManaged public var generatorVersion: String
    @NSManaged public var schemaVersion: String

    // Кэшированные метаданные для быстрого доступа.
    @NSManaged public var phraseCount: Int64
    @NSManaged public var vocabCount: Int64
    @NSManaged public var storyCount: Int64
    @NSManaged public var characterCountEs: Int64
    @NSManaged public var characterCountRu: Int64

    // Связи
    @NSManaged public var blocks: Set<LessonBlock>
    @NSManaged public var progress: LessonProgress?
    @NSManaged public var sessions: Set<LearningSession>
    @NSManaged public var audioFiles: Set<AudioFile>
    /// Плоский набор всех фраз/слов урока (обратная связь для Phrase.lesson).
    @NSManaged public var phrasesRel: Set<Phrase>

    @nonobjc public class func fetchRequest() -> NSFetchRequest<Lesson> {
        NSFetchRequest<Lesson>(entityName: "Lesson")
    }
}

extension Lesson: Identifiable {
    public var id: String { topicId }
}

extension Lesson {
    /// Блоки урока, упорядоченные по orderIndex.
    var orderedBlocks: [LessonBlock] {
        blocks.sorted { $0.orderIndex < $1.orderIndex }
    }

    /// Все фразы урока (verb_group + phrase_group, без словаря/рассказа).
    var phrases: [Phrase] {
        orderedBlocks
            .filter { $0.blockTypeEnum?.hasGroups == true }
            .flatMap { $0.orderedGroups }
            .flatMap { $0.orderedPhrases }
    }

    /// Все словарные слова урока.
    var words: [Phrase] {
        orderedBlocks
            .filter { $0.blockTypeEnum == .vocabulary }
            .flatMap { $0.orderedPhrases }
    }

    /// Все обучаемые элементы (фразы + слова) — то, что попадает в сессию.
    var allLearnablePhrases: [Phrase] {
        var result: [Phrase] = []
        for block in orderedBlocks {
            if block.blockTypeEnum?.hasGroups == true {
                result.append(contentsOf: block.orderedGroups.flatMap { $0.orderedPhrases })
            } else if block.blockTypeEnum == .vocabulary {
                result.append(contentsOf: block.orderedPhrases)
            }
        }
        return result
    }

    var storyBlocks: [LessonBlock] {
        orderedBlocks.filter { $0.blockTypeEnum == .story }
    }
}
