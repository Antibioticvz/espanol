import Foundation
import ZIPFoundation

/// Импорт ZIP-урока: распаковка, валидация, атомарное копирование, разрешение конфликтов (спека §11).
final class FileImportService {
    let repository: LessonRepository

    init(repository: LessonRepository) {
        self.repository = repository
    }

    /// Тестовый seam: если задан, вызывается после наполнения staging, но ДО атомарной
    /// подмены каталога назначения. Бросок отсюда имитирует сбой копирования на середине
    /// и должен оставить существующий урок нетронутым.
    var beforeSwapHook: (() throws -> Void)?

    // Лимиты против zip-бомбы/OOM (m21).
    static let maxUncompressedBytes: Int64 = 600 * 1024 * 1024 // 600 МБ
    static let maxArchiveEntries = 20_000
    static let maxLessonJsonBytes: Int64 = 25 * 1024 * 1024     // 25 МБ

    /// Результат распаковки и валидации — используется для показа инфо до импорта.
    struct Prepared {
        let manifest: LessonManifest
        /// Каталог с распакованным содержимым (lesson.json + audio/).
        let extractedRoot: URL
        /// Корневая временная папка распаковки (для гарантированной уборки).
        let tempDir: URL
        /// Существует ли уже урок с таким topic_id.
        let hasConflict: Bool
    }

    // MARK: - Unpack + validate

    /// Распаковывает ZIP во временную папку, парсит и валидирует lesson.json,
    /// проверяет наличие всех аудио-файлов. Не пишет в CoreData.
    /// При любой ошибке временная папка удаляется.
    func prepare(zipURL: URL) throws -> Prepared {
        AppPaths.ensureDirectories()
        let tempDir = AppPaths.tempImportsDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.removeItem(at: tempDir)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)

        do {
            let needsSecurityScope = zipURL.startAccessingSecurityScopedResource()
            defer { if needsSecurityScope { zipURL.stopAccessingSecurityScopedResource() } }

            // m21: до распаковки проверяем суммарный распакованный размер/число записей (zip-бомба).
            try enforceArchiveLimits(zipURL: zipURL)

            do {
                try FileManager.default.unzipItem(at: zipURL, to: tempDir)
            } catch {
                throw ImportError.cannotOpenArchive
            }

            // Некоторые ZIP оборачивают содержимое в одну корневую папку — учитываем это.
            let contentRoot = try locateContentRoot(in: tempDir)

            let jsonURL = contentRoot.appendingPathComponent("lesson.json")
            guard FileManager.default.fileExists(atPath: jsonURL.path) else {
                throw ImportError.missingJSON
            }
            // m21: не грузим в память гигантский lesson.json.
            let jsonSize = (try? FileManager.default.attributesOfItem(atPath: jsonURL.path)[.size] as? Int64) ?? nil
            if let jsonSize, jsonSize > Self.maxLessonJsonBytes {
                throw ImportError.tooLarge("lesson.json \(jsonSize) байт")
            }
            let data = try Data(contentsOf: jsonURL)
            let manifest = try LessonManifest.decodeValidating(from: data)

            try verifyAudioComplete(manifest: manifest, root: contentRoot)

            let hasConflict = (try? repository.lesson(topicId: manifest.topicId)) != nil
            return Prepared(manifest: manifest, extractedRoot: contentRoot,
                            tempDir: tempDir, hasConflict: hasConflict ?? false)
        } catch {
            // Любая ошибка валидации — чистим временную папку.
            try? FileManager.default.removeItem(at: tempDir)
            throw error
        }
    }

    // MARK: - Commit

    /// Завершает импорт: атомарно устанавливает файлы в Documents и индексирует урок.
    /// Временная папка удаляется в любом случае (успех, ошибка, отмена).
    /// - Returns: nil, если resolution == .cancel.
    @discardableResult
    func commit(_ prepared: Prepared, resolution: ImportConflictResolution) throws -> Lesson? {
        defer { cleanup(prepared) }
        if resolution == .cancel { return nil }

        let manifest = prepared.manifest
        let existing = try repository.lesson(topicId: manifest.topicId)
        let preserveStates = (resolution == .update)

        let destination = AppPaths.lessonsDirectory
            .appendingPathComponent(manifest.topicId, isDirectory: true)

        // C23 (защита в глубину): destination строго внутри каталога уроков.
        let base = AppPaths.lessonsDirectory.standardizedFileURL.path
        let destPath = destination.standardizedFileURL.path
        guard destPath == base || destPath.hasPrefix(base + "/") else {
            throw ImportError.invalidTopicId(manifest.topicId)
        }

        // Атомарная установка файлов: staging → проверка полноты → подмена.
        // Если что-то падает до подмены, существующий урок остаётся нетронутым.
        try atomicInstall(manifest: manifest, from: prepared.extractedRoot, to: destination)

        // Индексируем только после подтверждённой установки файлов.
        return try repository.index(
            manifest: manifest,
            existing: existing,
            preservingStates: preserveStates
        )
    }

    func cleanup(_ prepared: Prepared) {
        try? FileManager.default.removeItem(at: prepared.tempDir)
    }

    /// Удаляет всё содержимое temp_imports/ (вызывать при старте приложения — подметает
    /// «осиротевшие» папки после краха во время импорта).
    static func sweepTempImports() {
        let fm = FileManager.default
        guard let entries = try? fm.contentsOfDirectory(
            at: AppPaths.tempImportsDirectory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) else { return }
        for url in entries { try? fm.removeItem(at: url) }
    }

    /// m21: суммарный распакованный размер и число записей архива против zip-бомбы.
    private func enforceArchiveLimits(zipURL: URL) throws {
        guard let archive = Archive(url: zipURL, accessMode: .read) else {
            throw ImportError.cannotOpenArchive
        }
        var total: Int64 = 0
        var count = 0
        for entry in archive {
            count += 1
            if count > Self.maxArchiveEntries {
                throw ImportError.tooLarge("слишком много файлов в архиве")
            }
            total += Int64(entry.uncompressedSize)
            if total > Self.maxUncompressedBytes {
                throw ImportError.tooLarge("распакованный размер превышает лимит")
            }
        }
    }

    // MARK: - Atomic install

    private func atomicInstall(manifest: LessonManifest, from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        // Staging рядом с назначением (тот же том → атомарная подмена возможна).
        let staging = AppPaths.lessonsDirectory
            .appendingPathComponent(".staging-\(manifest.topicId)-\(UUID().uuidString)", isDirectory: true)
        try? fm.removeItem(at: staging)

        do {
            try fm.createDirectory(at: staging, withIntermediateDirectories: true)
            try copyTree(from: source, to: staging)
            // Убеждаемся, что staging полон, прежде чем что-либо трогать в назначении.
            try verifyAudioComplete(manifest: manifest, root: staging)
            // Тестовый seam: имитация сбоя ровно перед подменой.
            try beforeSwapHook?()
        } catch {
            try? fm.removeItem(at: staging)
            throw ImportError.copyFailed(describe(error))
        }

        do {
            if fm.fileExists(atPath: destination.path) {
                _ = try fm.replaceItemAt(destination, withItemAt: staging)
            } else {
                try fm.createDirectory(at: destination.deletingLastPathComponent(),
                                       withIntermediateDirectories: true)
                try fm.moveItem(at: staging, to: destination)
            }
        } catch {
            try? fm.removeItem(at: staging)
            throw ImportError.copyFailed(describe(error))
        }
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

    /// Проверяет наличие lesson.json и всех mp3 (по манифесту) в указанном корне.
    private func verifyAudioComplete(manifest: LessonManifest, root: URL) throws {
        let fm = FileManager.default
        guard fm.fileExists(atPath: root.appendingPathComponent("lesson.json").path) else {
            throw ImportError.missingJSON
        }
        for pair in manifest.allAudioPairs {
            for rel in [pair.es, pair.ru] {
                let fileURL = root.appendingPathComponent(rel)
                guard fm.fileExists(atPath: fileURL.path) else {
                    throw ImportError.missingAudioFile(rel)
                }
            }
        }
    }

    /// Копирует lesson.json и audio/ из source в destination (destination уже создан).
    private func copyTree(from source: URL, to destination: URL) throws {
        let fm = FileManager.default
        let jsonSrc = source.appendingPathComponent("lesson.json")
        try fm.copyItem(at: jsonSrc, to: destination.appendingPathComponent("lesson.json"))
        let audioSrc = source.appendingPathComponent("audio")
        if fm.fileExists(atPath: audioSrc.path) {
            try fm.copyItem(at: audioSrc, to: destination.appendingPathComponent("audio"))
        }
    }

    private func describe(_ error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
