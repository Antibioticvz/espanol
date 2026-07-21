import CoreData

@objc(LearningSession)
public final class LearningSession: NSManagedObject {
    @NSManaged public var sessionId: UUID
    @NSManaged public var startedAt: Date
    @NSManaged public var completedAt: Date?
    @NSManaged public var configData: Data

    @NSManaged public var phrasesCount: Int64
    @NSManaged public var phrasesRepeats: Int64
    @NSManaged public var actualDurationSeconds: Int64
    @NSManaged public var phrasesCompletedCount: Int64
    /// Средняя скорость (для достижений speedDemon).
    @NSManaged public var speed: Double

    // Связи. lesson опционален (D-17): сессия переживает удаление урока.
    @NSManaged public var lesson: Lesson?
    @NSManaged public var phraseUpdates: Set<PhraseStateUpdate>

    @nonobjc public class func fetchRequest() -> NSFetchRequest<LearningSession> {
        NSFetchRequest<LearningSession>(entityName: "LearningSession")
    }
}

extension LearningSession {
    var completionPercent: Double {
        phrasesCount > 0 ? Double(phrasesCompletedCount) / Double(phrasesCount) : 0
    }

    var config: SessionConfig? {
        try? JSONDecoder().decode(SessionConfig.self, from: configData)
    }

    var orderedUpdates: [PhraseStateUpdate] {
        phraseUpdates.sorted { $0.updatedAt < $1.updatedAt }
    }
}
