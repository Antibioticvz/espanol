import CoreData

@objc(AudioFile)
public final class AudioFile: NSManagedObject {
    @NSManaged public var fileId: String
    @NSManaged public var language: String
    /// Путь относительно каталога Documents (переносимый между запусками).
    @NSManaged public var relativePath: String
    @NSManaged public var durationMs: Int64
    @NSManaged public var fileSize: Int64
    @NSManaged public var isDownloaded: Bool

    // Связи
    @NSManaged public var lesson: Lesson
    @NSManaged public var phrase: Phrase?
    @NSManaged public var block: LessonBlock?

    @nonobjc public class func fetchRequest() -> NSFetchRequest<AudioFile> {
        NSFetchRequest<AudioFile>(entityName: "AudioFile")
    }
}

extension AudioFile {
    /// Абсолютный URL файла, вычисляемый от текущего каталога Documents.
    /// Хранение относительного пути защищает от смены sandbox-контейнера.
    var fileURL: URL {
        AppPaths.documentsURL.appendingPathComponent(relativePath)
    }

    var durationSeconds: TimeInterval { Double(durationMs) / 1000.0 }
}
