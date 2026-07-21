import CoreData

@objc(PhraseStateUpdate)
public final class PhraseStateUpdate: NSManagedObject {
    @NSManaged public var phraseId: String
    @NSManaged public var oldState: String
    @NSManaged public var newState: String
    @NSManaged public var updatedAt: Date

    // Связи
    @NSManaged public var session: LearningSession

    @nonobjc public class func fetchRequest() -> NSFetchRequest<PhraseStateUpdate> {
        NSFetchRequest<PhraseStateUpdate>(entityName: "PhraseStateUpdate")
    }
}

extension PhraseStateUpdate {
    var oldStateEnum: PhraseState { PhraseState(rawValue: oldState) ?? .learning }
    var newStateEnum: PhraseState { PhraseState(rawValue: newState) ?? .learning }
}
