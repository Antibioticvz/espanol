import SwiftUI

/// Экран 7: параметры (спека §4.9). Каждая настройка реально влияет на поведение.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var showRestore = false
    @State private var infoMessage: String?
    @State private var backupSize = 0
    @State private var isWorking = false
    @State private var exportURL: URL?
    @State private var showShare = false
    @State private var confirmClearStage = 0

    var body: some View {
        @Bindable var settings = env.settings
        NavigationStack {
            Form {
                appearanceSection(settings)
                audioSection(settings)
                learningSection(settings)
                sessionDefaultsSection(settings)
                dataSection
                Section {
                    NavigationLink { AboutView() } label: {
                        Label("О приложении", systemImage: "info.circle")
                    }
                }
            }
            .navigationTitle("Параметры")
            .sheet(isPresented: $showRestore) { BackupRestoreView() }
            .sheet(isPresented: $showShare) {
                if let exportURL { ShareSheet(items: [exportURL]) }
            }
            .alert("Готово", isPresented: Binding(get: { infoMessage != nil }, set: { if !$0 { infoMessage = nil } })) {
                Button("OK", role: .cancel) { infoMessage = nil }
            } message: { Text(infoMessage ?? "") }
            .task { backupSize = env.backup.totalBackupSize() }
        }
    }

    // MARK: - Sections

    private func appearanceSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section {
            Picker("Тема оформления", selection: $settings.theme) {
                ForEach(ThemeStyle.allCases) { Text($0.titleRu).tag($0) }
            }
        } header: {
            Text("Внешний вид")
        } footer: {
            Text("Размер шрифта следует системному (Настройки → Экран и яркость → Размер текста).")
        }
    }

    private func audioSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section("Аудио") {
            Toggle("Вибрация", isOn: $settings.vibrationEnabled)
            Toggle("Вибрация при завершении", isOn: $settings.sessionCompleteVibration)
            VStack(alignment: .leading) {
                Text("Громкость по умолчанию: \(Int(settings.defaultVolume * 100))%")
                Slider(value: $settings.defaultVolume, in: 0...1, step: 0.05)
            }
        }
    }

    private func learningSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section("Обучение") {
            Picker("Режим по умолчанию", selection: $settings.defaultPlaybackMode) {
                ForEach(PlaybackMode.allCases) { Text($0.titleRu).tag($0) }
            }
            Picker("Текст на lock screen", selection: $settings.lockScreenDisplay) {
                ForEach(LockScreenTextMode.allCases) { Text($0.titleRu).tag($0) }
            }
            Toggle("Обновлять статусы фраз", isOn: $settings.defaultTrackProgress)
        }
    }

    private func sessionDefaultsSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section("Дефолты сессии") {
            Stepper("Повторений: \(settings.defaultRepetitions)", value: $settings.defaultRepetitions, in: 1...10)
            Picker("Скорость", selection: $settings.defaultSpeed) {
                ForEach(SessionConfig.allowedSpeeds, id: \.self) { s in
                    Text(s.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(s)).0x" : "\(s)x").tag(s)
                }
            }
            Stepper("Пауза: \(Int(settings.defaultPauseSeconds)) сек", value: $settings.defaultPauseSeconds, in: 0...15, step: 1)
        }
    }

    private var dataSection: some View {
        Section("Данные и резервная копия") {
            LabeledContent("Размер копий", value: ByteCountFormatter.string(fromByteCount: Int64(backupSize), countStyle: .file))
            if let last = env.backup.lastBackupDate {
                LabeledContent("Последняя копия", value: Format.dateTime(last))
            }
            Button {
                createBackup()
            } label: {
                Label("Создать резервную копию", systemImage: "externaldrive.badge.plus")
            }
            .disabled(isWorking)
            Button { showRestore = true } label: {
                Label("Восстановить из копии", systemImage: "arrow.uturn.backward")
            }
            Button {
                exportData()
            } label: {
                Label("Экспортировать данные (ZIP)", systemImage: "square.and.arrow.up")
            }
            .disabled(isWorking)
            Button(role: .destructive) {
                confirmClearStage = 1
            } label: {
                Label("Очистить все данные", systemImage: "trash")
            }
        }
        .confirmationDialog("Очистить все данные?", isPresented: Binding(
            get: { confirmClearStage == 1 }, set: { if !$0 { confirmClearStage = 0 } }
        ), titleVisibility: .visible) {
            Button("Продолжить", role: .destructive) { confirmClearStage = 2 }
            Button("Отмена", role: .cancel) { confirmClearStage = 0 }
        } message: {
            Text("Будут удалены все уроки, прогресс и резервные копии.")
        }
        .confirmationDialog("Точно удалить всё? Это необратимо.", isPresented: Binding(
            get: { confirmClearStage == 2 }, set: { if !$0 { confirmClearStage = 0 } }
        ), titleVisibility: .visible) {
            Button("Удалить всё", role: .destructive) { clearAll() }
            Button("Отмена", role: .cancel) { confirmClearStage = 0 }
        }
    }

    // MARK: - Actions

    private func createBackup() {
        isWorking = true
        Task {
            let ok = (try? env.backup.createBackup(settings: env.settings.snapshot())) != nil
            backupSize = env.backup.totalBackupSize()
            isWorking = false
            infoMessage = ok ? "Резервная копия создана." : "Не удалось создать копию."
        }
    }

    private func exportData() {
        isWorking = true
        Task {
            let url = try? await Task.detached { try BackupService.exportAllData() }.value
            isWorking = false
            if let url {
                exportURL = url
                showShare = true
            } else {
                infoMessage = "Не удалось экспортировать данные."
            }
        }
    }

    private func clearAll() {
        confirmClearStage = 0
        env.deleteAllData()
        backupSize = env.backup.totalBackupSize()
        infoMessage = "Все данные удалены."
    }
}

/// Список резервных копий для восстановления.
struct BackupRestoreView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @State private var backups: [URL] = []
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                if backups.isEmpty {
                    Text("Нет резервных копий").foregroundStyle(.secondary)
                }
                ForEach(backups, id: \.self) { url in
                    Button {
                        restore(url)
                    } label: {
                        VStack(alignment: .leading) {
                            Text(url.lastPathComponent).font(.subheadline)
                            if let date = modificationDate(url) {
                                Text(Format.dateTime(date)).font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Восстановление")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Закрыть") { dismiss() } }
            }
            .onAppear { backups = env.backup.availableBackups() }
            .alert("Восстановление", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) { message = nil; dismiss() }
            } message: {
                Text(message ?? "")
            }
        }
    }

    private func restore(_ url: URL) {
        if let count = try? env.backup.restore(from: url) {
            env.refreshWidgetStats()
            message = "Восстановлено фраз: \(count)"
        } else {
            message = "Не удалось восстановить копию."
        }
    }

    private func modificationDate(_ url: URL) -> Date? {
        try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate
    }
}
