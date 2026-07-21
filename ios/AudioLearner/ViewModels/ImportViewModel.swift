import CoreData
import Foundation
import Observation

/// Управляет импортом ZIP: инспекция, разрешение конфликта, копирование (спека §4.3, §11).
@MainActor
@Observable
final class ImportViewModel {
    @ObservationIgnored let env: AppEnvironment

    var isBusy = false
    var statusText = ""
    var errorMessage: String?
    var prepared: FileImportService.Prepared?
    var didImport = false

    init(env: AppEnvironment) {
        self.env = env
    }

    var manifest: LessonManifest? { prepared?.manifest }
    var hasConflict: Bool { prepared?.hasConflict ?? false }

    /// Разбирает выбранный ZIP и показывает информацию об уроке.
    func inspect(url: URL) async {
        errorMessage = nil
        isBusy = true
        statusText = "Проверка архива…"
        defer { isBusy = false; statusText = "" }

        let ctx = env.persistence.newBackgroundContext()
        do {
            let prepared = try await ctx.perform {
                let repo = LessonRepository(context: ctx)
                let service = FileImportService(repository: repo)
                return try service.prepare(zipURL: url)
            }
            self.prepared = prepared
        } catch {
            self.errorMessage = message(for: error)
        }
    }

    /// Выполняет импорт с выбранным разрешением конфликта.
    func performImport(resolution: ImportConflictResolution) async {
        guard let prepared else { return }
        if resolution == .cancel { return }
        errorMessage = nil
        isBusy = true
        statusText = "Импорт урока…"
        defer { isBusy = false; statusText = "" }

        let ctx = env.persistence.newBackgroundContext()
        do {
            try await ctx.perform {
                let repo = LessonRepository(context: ctx)
                let service = FileImportService(repository: repo)
                _ = try service.commit(prepared, resolution: resolution)
            }
            didImport = true
            env.refreshWidgetStats()
        } catch {
            self.errorMessage = message(for: error)
        }
    }

    func resetSelection() {
        prepared = nil
        errorMessage = nil
        didImport = false
    }

    private func message(for error: Error) -> String {
        (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
}
