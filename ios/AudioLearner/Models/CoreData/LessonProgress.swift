import CoreData

@objc(LessonProgress)
public final class LessonProgress: NSManagedObject {
    @NSManaged public var phrasesLearning: Int64
    @NSManaged public var phrasesInProgress: Int64
    @NSManaged public var phrasesMastered: Int64

    @NSManaged public var totalSessionsCompleted: Int64
    @NSManaged public var totalMinutesLearned: Int64
    @NSManaged public var totalPhrasesReviewed: Int64
    @NSManaged public var streakDays: Int64
    @NSManaged public var bestStreakDays: Int64
    @NSManaged public var lastAccessedAt: Date?
    @NSManaged public var lastCompletedSessionAt: Date?

    // Связи
    @NSManaged public var lesson: Lesson

    @nonobjc public class func fetchRequest() -> NSFetchRequest<LessonProgress> {
        NSFetchRequest<LessonProgress>(entityName: "LessonProgress")
    }
}

extension LessonProgress {
    var totalPhrases: Int64 { phrasesLearning + phrasesInProgress + phrasesMastered }

    var percentMastered: Double {
        totalPhrases > 0 ? Double(phrasesMastered) / Double(totalPhrases) : 0
    }
}
