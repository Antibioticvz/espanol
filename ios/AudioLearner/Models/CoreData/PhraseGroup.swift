import CoreData

@objc(PhraseGroup)
public final class PhraseGroup: NSManagedObject {
    @NSManaged public var key: String
    @NSManaged public var titleRu: String?
    @NSManaged public var translationRu: String?
    @NSManaged public var orderIndex: Int64

    // Связи
    @NSManaged public var block: LessonBlock
    @NSManaged public var phrases: Set<Phrase>

    @nonobjc public class func fetchRequest() -> NSFetchRequest<PhraseGroup> {
        NSFetchRequest<PhraseGroup>(entityName: "PhraseGroup")
    }
}

extension PhraseGroup {
    var orderedPhrases: [Phrase] {
        phrases.sorted { $0.orderIndex < $1.orderIndex }
    }

    /// Отображаемое имя группы: название категории или перевод инфинитива.
    var displayTitle: String {
        if let titleRu, !titleRu.isEmpty { return titleRu }
        if let translationRu, !translationRu.isEmpty { return "\(key) — \(translationRu)" }
        return key
    }
}
