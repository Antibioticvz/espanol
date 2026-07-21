import SwiftUI
import UniformTypeIdentifiers

/// Экран импорта урока (спека §4.3).
struct ImportLessonView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss

    let initialURL: URL?

    @State private var vm: ImportViewModel?
    @State private var showFileImporter = false
    @State private var conflictResolution: ImportConflictResolution = .update

    var body: some View {
        NavigationStack {
            Form {
                if let vm, let manifest = vm.manifest {
                    lessonInfoSection(manifest)
                    if vm.hasConflict {
                        conflictSection(manifest)
                    }
                    importButtonSection(vm)
                } else {
                    pickSection
                }

                if let vm, vm.isBusy {
                    Section {
                        HStack {
                            ProgressView()
                            Text(vm.statusText)
                        }
                    }
                }
                if let message = vm?.errorMessage {
                    Section {
                        Label(message, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Импорт урока")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { close() }
                }
            }
            .fileImporter(isPresented: $showFileImporter,
                          allowedContentTypes: [.zip],
                          allowsMultipleSelection: false) { result in
                handleFileSelection(result)
            }
            .task {
                if vm == nil { vm = ImportViewModel(env: env) }
                if let url = initialURL ?? env.pendingImportURL {
                    await inspect(url)
                }
            }
            .onChange(of: vm?.didImport ?? false) { _, done in
                if done {
                    Haptics.success(enabled: env.settings.vibrationEnabled)
                    close()
                }
            }
        }
    }

    // MARK: - Sections

    private var pickSection: some View {
        Section {
            Button {
                showFileImporter = true
            } label: {
                Label("Выбрать файл ZIP", systemImage: "folder")
            }
        } footer: {
            Text("Выберите ZIP-урок из Файлов или iCloud Drive. Или откройте ZIP в приложении через «Открыть в…».")
        }
    }

    private func lessonInfoSection(_ manifest: LessonManifest) -> some View {
        Section("Информация об уроке") {
            infoRow("Название", manifest.titleRu)
            infoRow("ID", manifest.topicId)
            infoRow("Фраз", String(manifest.stats.phraseCount))
            infoRow("Слов", String(manifest.stats.vocabCount))
            infoRow("Рассказов", String(manifest.stats.storyCount))
            infoRow("Дата создания", Format.dateTime(manifest.createdAt))
            infoRow("Версия генератора", manifest.generatorVersion)
        }
    }

    private func conflictSection(_ manifest: LessonManifest) -> some View {
        Section {
            Picker("Действие", selection: $conflictResolution) {
                Text("Обновить (сохранить прогресс)").tag(ImportConflictResolution.update)
                Text("Заменить (потерять прогресс)").tag(ImportConflictResolution.replace)
            }
            .pickerStyle(.inline)
        } header: {
            Label("Урок «\(manifest.titleRu)» уже импортирован", systemImage: "exclamationmark.triangle")
        } footer: {
            Text("«Обновить» заменит аудио и тексты, сохранив статусы фраз. «Заменить» удалит весь прогресс урока.")
        }
    }

    private func importButtonSection(_ vm: ImportViewModel) -> some View {
        Section {
            Button {
                Task {
                    let resolution = vm.hasConflict ? conflictResolution : .replace
                    await vm.performImport(resolution: resolution)
                }
            } label: {
                Label("Импортировать", systemImage: "square.and.arrow.down")
            }
            .disabled(vm.isBusy)
        }
    }

    private func infoRow(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    // MARK: - Actions

    private func handleFileSelection(_ result: Result<[URL], Error>) {
        switch result {
        case .success(let urls):
            guard let url = urls.first else { return }
            Task { await inspect(url) }
        case .failure(let error):
            vm?.errorMessage = error.localizedDescription
        }
    }

    private func inspect(_ url: URL) async {
        guard let vm else { return }
        let didAccess = url.startAccessingSecurityScopedResource()
        defer { if didAccess { url.stopAccessingSecurityScopedResource() } }
        await vm.inspect(url: url)
    }

    private func close() {
        env.pendingImportURL = nil
        dismiss()
    }
}
