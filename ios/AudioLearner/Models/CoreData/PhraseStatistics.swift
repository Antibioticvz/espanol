import CoreData

@objc(PhraseStatistics)
public final class PhraseStatistics: NSManagedObject {
    @NSManaged public var correctCount: Int64
    @NSManaged public var totalReviewCount: Int64
    @NSManaged public var lastReviewedAt: Date?
    @NSManaged public var averageReviewTime: Double

    // Связи
    @NSManaged public var phrase: Phrase

    @nonobjc public class func fetchRequest() -> NSFetchRequest<PhraseStatistics> {
        NSFetchRequest<PhraseStatistics>(entityName: "PhraseStatistics")
    }
}
