import Foundation
import ZIPFoundation

/// Импорт ZIP-урока: распаковка, валидация, копирование, разрешение конфликтов (спека §11).
final class FileImportService {
    let repository: LessonRepository

    init(repository: LessonRepository) {
        self.repository = repository
    }

    /// Результат распаковки и валидации — используется для показа инфо до импорта.
    struct Prepared {
        let manifest: LessonManifest
        /// Каталог с распакованным содержимым (lesson.json + audio/).
        let extractedRoot: URL
        /// Существует ли уже урок с таким topic_id.
        let hasConflict: Bool
    }

    // MARK: - Unpack + validate

    /// Распаковывает ZIP во временную папку, парсит и валидирует lesson.json,
    /// проверяет наличие всех аудио-файлов. Не пишет в CoreData.
    func prepare(zipURL: URL) throws -> Prepared {
        AppPaths.ensureDirectories()
        let extractedRoot = AppPaths.tempImportsDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.removeItem(at: extractedRoot)
        try FileManager.default.createDirectory(at: extractedRoot, withIntermediateDirectories: true)

        // Некоторые ZIP оборачивают содержимое в одну корневую папку — учитываем это.
        let needsSecurityScope = zipURL.startAccessingSecurityScopedResource()
        defer { if needsSecurityScope { zipURL.stopAccessingSecurityScopedResource() } }

        do {
            try FileManager.default.unzipItem(at: zipURL, to: extractedRoot)
        } catch {
            throw ImportError.cannotOpenArchive
        }

        let contentRoot = try locateContentRoot(in: extractedRoot)

        let jsonURL = contentRoot.appendingPathComponent("lesson.json")
        guard FileManager.default.fileExists(atPath: jsonURL.path) else {
            throw ImportError.missingJSON
        }
        let data = try Data(contentsOf: jsonURL)
        let manifest = try LessonManifest.decodeValidating(from: data)

        // Проверяем наличие всех mp3.
        for pair in manifest.allAudioPairs {
            for rel in [pair.es, pair.ru] {
                let fileURL = contentRoot.appendingPathComponent(rel)
                guard FileManager.default.fileExists(atPath: fileURL.path) else {
                    throw ImportError.missingAudioFile(rel)
                }
            }
        }

        let hasConflict = (try? repository.lesson(topicId: manifest.topicId)) != nil
        return Prepared(manifest: manifest, extractedRoot: contentRoot, hasConflict: hasConflict ?? false)
    }

    // MARK: - Commit

    /// Завершает импорт: копирует файлы в Documents и индексирует урок в CoreData.
    /// - Returns: nil, если resolution == .cancel.
    @discardableResult
    func commit(_ prepared: Prepared, resolution: ImportConflictResolution) throws -> Lesson? {
        if resolution == .cancel { return nil }

        let manifest = prepared.manifest
        let existing = try repository.lesson(topicId: manifest.topicId)
        let preserveStates = (resolution == .update)

        // Каталог назначения.
        let destination = AppPaths.lessonsDirectory
            .appendingPathComponent(manifest.topicId, isDirectory: true)

        if resolution == .replace {
            try? FileManager.default.removeItem(at: destination)
        }
        try copyContents(from: prepared.extractedRoot, to: destination)

        let lesson = try repository.index(
            manifest: manifest,
            existing: existing,
            preservingStates: preserveStates
        )

        // Уборка временной папки.
        cleanup(prepared)
        return lesson
    }

    func cleanup(_ prepared: Prepared) {
        // Удаляем родительскую temp-папку (extractedRoot может быть вложенным contentRoot).
        var dir = prepared.extractedRoot
        while dir.deletingLastPathComponent().lastPathComponent != "temp_imports"
                && dir.pathComponents.count > AppPaths.tempImportsDirectory.pathComponents.count {
            dir = dir.deletingLastPathComponent()
        }
        try? FileManager.default.removeItem(at: dir)
    }

    // MARK: - Private

    /// Определяет реальный корень с lesson.json (учёт «single top folder» в архиве).
    private func locateContentRoot(in root: URL) throws -> URL {
        if FileManager.default.fileExists(atPath: root.appendingPathComponent("lesson.json").path) {
            return root
        }
        let entries = (try? FileManager.default.contentsOfDirectory(
            at: root,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        )) ?? []
        let dirs = entries.filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true }
        for dir in dirs {
            if FileManager.default.fileExists(atPath: dir.appendingPathComponent("lesson.json").path) {
                return dir
            }
        }
        return root
    }

    private func copyContents(from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        do {
            try fm.createDirectory(at: destination, withIntermediateDirectories: true)
            // Копируем lesson.json.
            let jsonSrc = source.appendingPathComponent("lesson.json")
            let jsonDst = destination.appendingPathComponent("lesson.json")
            try? fm.removeItem(at: jsonDst)
            try fm.copyItem(at: jsonSrc, to: jsonDst)
            // Копируем audio/ рекурсивно.
            let audioSrc = source.appendingPathComponent("audio")
            if fm.fileExists(atPath: audioSrc.path) {
                let audioDst = destination.appendingPathComponent("audio")
                try? fm.removeItem(at: audioDst)
                try fm.copyItem(at: audioSrc, to: audioDst)
            }
        } catch {
            throw ImportError.copyFailed(error.localizedDescription)
        }
    }
}
