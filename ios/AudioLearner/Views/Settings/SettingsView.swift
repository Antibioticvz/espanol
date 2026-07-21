import SwiftUI

/// Экран 7: параметры (спека §4.9).
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var showRestore = false
    @State private var backupMessage: String?

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
            .sheet(isPresented: $showRestore) {
                BackupRestoreView()
            }
            .alert("Резервная копия", isPresented: Binding(get: { backupMessage != nil }, set: { if !$0 { backupMessage = nil } })) {
                Button("OK", role: .cancel) { backupMessage = nil }
            } message: {
                Text(backupMessage ?? "")
            }
        }
    }

    private func appearanceSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section("Внешний вид") {
            Picker("Тема оформления", selection: $settings.theme) {
                ForEach(ThemeStyle.allCases) { Text($0.titleRu).tag($0) }
            }
            VStack(alignment: .leading) {
                Text("Размер шрифта: \(Int(settings.fontScale * 100))%")
                Slider(value: $settings.fontScale, in: 0.8...1.4, step: 0.1)
            }
        }
    }

    private func audioSection(_ settings: AppSettings) -> some View {
        @Bindable var settings = settings
        return Section("Аудио") {
            Toggle("Вибрация", isOn: $settings.vibrationEnabled)
            Toggle("Звуки перехода", isOn: $settings.soundEnabled)
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
            Toggle("Автопереход к след. фразе", isOn: $settings.autoNextPhrase)
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
            let size = env.backup.totalBackupSize()
            LabeledContent("Размер копий", value: byteString(size))
            Button {
                if (try? env.backup.createBackup(settings: env.settings.snapshot())) != nil {
                    backupMessage = "Резервная копия создана."
                } else {
                    backupMessage = "Не удалось создать копию."
                }
            } label: {
                Label("Создать резервную копию", systemImage: "externaldrive.badge.plus")
            }
            Button {
                showRestore = true
            } label: {
                Label("Восстановить из копии", systemImage: "arrow.uturn.backward")
            }
        }
    }

    private func byteString(_ bytes: Int) -> String {
        ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
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
