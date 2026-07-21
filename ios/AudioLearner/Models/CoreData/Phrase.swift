import CoreData

@objc(Phrase)
public final class Phrase: NSManagedObject {
    @NSManaged public var phraseId: String
    @NSManaged public var textEs: String
    @NSManaged public var textRu: String
    @NSManaged public var orderIndex: Int64

    // Прогресс обучения (спека §3.4)
    @NSManaged public var state: String
    @NSManaged public var lastReviewDate: Date?
    @NSManaged public var reviewCount: Int64
    @NSManaged public var nextReviewDate: Date?
    @NSManaged public var easeFactor: Double
    @NSManaged public var interval: Int64
    /// Отмечена как избранная (быстрый повтор).
    @NSManaged public var isFavorite: Bool

    // Связи
    @NSManaged public var group: PhraseGroup?
    @NSManaged public var block: LessonBlock?
    @NSManaged public var lesson: Lesson?
    @NSManaged public var statistics: PhraseStatistics?
    @NSManaged public var audioFiles: Set<AudioFile>

    @nonobjc public class func fetchRequest() -> NSFetchRequest<Phrase> {
        NSFetchRequest<Phrase>(entityName: "Phrase")
    }
}

extension Phrase {
    var stateEnum: PhraseState {
        get { PhraseState(rawValue: state) ?? .learning }
        set { state = newValue.rawValue }
    }

    var audioEs: AudioFile? { audioFiles.first { $0.language == PhraseLanguage.es.rawValue } }
    var audioRu: AudioFile? { audioFiles.first { $0.language == PhraseLanguage.ru.rawValue } }

    /// Суммарная длительность обоих аудио в секундах.
    var durationSeconds: TimeInterval {
        let es = Double(audioEs?.durationMs ?? 0)
        let ru = Double(audioRu?.durationMs ?? 0)
        return (es + ru) / 1000.0
    }

    /// Является ли элемент словом (из vocabulary-блока).
    var isVocabularyWord: Bool {
        block?.blockTypeEnum == .vocabulary
    }
}
