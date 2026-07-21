import CoreData

@objc(LessonBlock)
public final class LessonBlock: NSManagedObject {
    @NSManaged public var blockId: String
    @NSManaged public var type: String
    @NSManaged public var titleRu: String
    @NSManaged public var titleEs: String?
    @NSManaged public var orderIndex: Int64

    // Только для type == story
    @NSManaged public var textEs: String?
    @NSManaged public var textRu: String?
    @NSManaged public var splitByPhrase: Bool

    // Связи
    @NSManaged public var lesson: Lesson
    @NSManaged public var groups: Set<PhraseGroup>
    @NSManaged public var phrases: Set<Phrase>
    @NSManaged public var audioFiles: Set<AudioFile>

    @nonobjc public class func fetchRequest() -> NSFetchRequest<LessonBlock> {
        NSFetchRequest<LessonBlock>(entityName: "LessonBlock")
    }
}

extension LessonBlock {
    var blockTypeEnum: LessonBlockType? { LessonBlockType(rawValue: type) }

    var orderedGroups: [PhraseGroup] {
        groups.sorted { $0.orderIndex < $1.orderIndex }
    }

    var orderedPhrases: [Phrase] {
        phrases.sorted { $0.orderIndex < $1.orderIndex }
    }

    var audioEs: AudioFile? { audioFiles.first { $0.language == PhraseLanguage.es.rawValue } }
    var audioRu: AudioFile? { audioFiles.first { $0.language == PhraseLanguage.ru.rawValue } }
}
