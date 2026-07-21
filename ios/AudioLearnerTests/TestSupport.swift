import CoreData
import XCTest
@testable import AudioLearner

/// Общие помощники для тестов: in-memory CoreData, доступ к фикстуре, изоляция Documents.
enum TestSupport {
    /// URL фикстурного ZIP из бандла тестов.
    static func fixtureURL(file: StaticString = #filePath, line: UInt = #line) throws -> URL {
        let bundle = Bundle(for: BundleToken.self)
        if let url = bundle.url(forResource: "lesson-04-hablar-de-mi-mismo", withExtension: "zip") {
            return url
        }
        // Fallback: искать в подпапке Fixtures бандла.
        if let url = bundle.url(forResource: "lesson-04-hablar-de-mi-mismo", withExtension: "zip", subdirectory: "Fixtures") {
            return url
        }
        throw XCTSkip("Фикстура lesson-04-hablar-de-mi-mismo.zip не найдена в бандле тестов")
    }

    /// Уникальный временный каталог «Documents» для изоляции файлов теста.
    static func makeTempDocuments() -> URL {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent("ALTests-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}

private final class BundleToken {}

/// Базовый класс: настраивает in-memory стек и изолированный Documents.
class AudioLearnerTestCase: XCTestCase {
    var controller: PersistenceController!
    var context: NSManagedObjectContext!
    var repository: LessonRepository!
    private var tempDocuments: URL!

    override func setUpWithError() throws {
        try super.setUpWithError()
        tempDocuments = TestSupport.makeTempDocuments()
        AppPaths.overrideDocumentsURL = tempDocuments
        controller = PersistenceController(inMemory: true)
        context = controller.viewContext
        repository = LessonRepository(context: context)
    }

    override func tearDownWithError() throws {
        AppPaths.overrideDocumentsURL = nil
        if let tempDocuments {
            try? FileManager.default.removeItem(at: tempDocuments)
        }
        controller = nil
        context = nil
        repository = nil
        try super.tearDownWithError()
    }

    /// Импортирует фикстуру в in-memory стек, возвращает урок.
    @discardableResult
    func importFixture(resolution: ImportConflictResolution = .replace) throws -> Lesson {
        let service = FileImportService(repository: repository)
        let prepared = try service.prepare(zipURL: try TestSupport.fixtureURL())
        let lesson = try XCTUnwrap(try service.commit(prepared, resolution: resolution))
        return lesson
    }
}
