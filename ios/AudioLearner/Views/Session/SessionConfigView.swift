import SwiftUI

/// Экран 3: конфигурация сессии (спека §4.5).
struct SessionConfigView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        @Bindable var flow = env.sessionFlow
        let isFlashcards = flow.config.isFlashcards
        Form {
            Section {
                LabeledContent(isFlashcards ? "Карточек" : "Выбрано фраз",
                               value: String(flow.selectedPhraseIds.count))
                if !isFlashcards {
                    LabeledContent("Ожидаемое время", value: Format.duration(estimatedDuration))
                }
            }

            Section("Режим сессии") {
                Picker("Режим", selection: $flow.config.playbackMode) {
                    ForEach(PlaybackMode.allCases) { mode in
                        Text(mode.titleRu).tag(mode)
                    }
                }
                .pickerStyle(.inline)
                if flow.config.playbackMode == .cycleSession {
                    Stepper(value: $flow.config.sessionCycles, in: 1...10) {
                        Text("Циклов: \(flow.config.sessionCycles)")
                    }
                }
            }

            if isFlashcards {
                Section("Флеш-карты") {
                    Picker("Направление", selection: $flow.config.flashcardDirection) {
                        ForEach(FlashcardDirection.allCases) { Text($0.titleRu).tag($0) }
                    }
                    .pickerStyle(.inline)
                    Toggle("Автоозвучка карточки", isOn: $flow.config.flashcardAutoplay)
                }
            } else {
                Section("Количество повторений") {
                    Stepper(value: $flow.config.repetitions, in: 1...10) {
                        Text("Повторений: \(flow.config.repetitions)")
                    }
                    Text("Каждую фразу повторим \(flow.config.repetitions) раз")
                        .font(.caption).foregroundStyle(.secondary)
                }

                Section("Порядок сторон") {
                    Picker("Порядок", selection: $flow.config.sideOrder) {
                        ForEach(SideOrder.allCases) { Text($0.titleRu).tag($0) }
                    }
                    .pickerStyle(.inline)
                }

                Section("Пауза между сторонами") {
                    Picker("Тип паузы", selection: $flow.config.pauseMode) {
                        ForEach(PauseMode.allCases) { Text($0.titleRu).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    if flow.config.pauseMode == .fixed {
                        Stepper(value: $flow.config.pauseSeconds, in: 0...15, step: 1) {
                            Text("Пауза: \(Int(flow.config.pauseSeconds)) сек")
                        }
                    } else {
                        Picker("Коэффициент", selection: $flow.config.pauseCoefficient) {
                            ForEach(SessionConfig.allowedPauseCoefficients, id: \.self) { c in
                                Text("×\(coeffLabel(c))").tag(c)
                            }
                        }
                        Text("Пауза = длина стороны × \(coeffLabel(flow.config.pauseCoefficient))")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Автоскорость") {
                    Toggle("Замедлять слабые фразы", isOn: $flow.config.autoSpeedByStatus)
                    if flow.config.autoSpeedByStatus {
                        Text("Учу ×0.75 · В процессе ×0.9 · Выучено ×1.0")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Текст на экране блокировки") {
                    Picker("Показ текста", selection: $flow.config.lockScreenTextMode) {
                        ForEach(LockScreenTextMode.allCases) { mode in
                            Text(mode.titleRu).tag(mode)
                        }
                    }
                    .pickerStyle(.inline)
                }
            }

            Section("Скорость озвучки") {
                Picker("Скорость", selection: $flow.config.speed) {
                    ForEach(SessionConfig.allowedSpeeds, id: \.self) { speed in
                        Text(speedLabel(speed)).tag(speed)
                    }
                }
                .pickerStyle(.segmented)
                Text("Без изменения высоты тона")
                    .font(.caption).foregroundStyle(.secondary)
            }

            Section("Отслеживание прогресса") {
                Toggle("Обновлять статусы фраз", isOn: $flow.config.trackProgress)
            }

            if !isFlashcards {
                Section("Расчёт") {
                    LabeledContent("Фраз", value: String(flow.selectedPhraseIds.count))
                    LabeledContent("Повторений", value: String(flow.config.repetitions))
                    LabeledContent("Скорость", value: speedLabel(flow.config.speed))
                    LabeledContent("Общее время (примерно)", value: Format.duration(estimatedDuration))
                }
            }
        }
        .navigationTitle("Параметры сессии")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Назад") {
                    if env.sessionFlow.isDailySession {
                        env.sessionFlow.reset()
                    } else {
                        env.sessionFlow.step = .selectPhrases
                    }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                Button {
                    Haptics.impact(.medium, enabled: env.settings.vibrationEnabled)
                    env.sessionFlow.step = .player
                } label: {
                    Label("Начать", systemImage: "play.fill")
                }
                .disabled(flow.selectedPhraseIds.isEmpty)
            }
        }
    }

    private func speedLabel(_ speed: Double) -> String {
        speed == 1.0 ? "1.0x" : (speed.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(speed)).0x" : "\(speed)x")
    }

    private func coeffLabel(_ c: Double) -> String {
        c.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(c)).0" : String(format: "%g", c)
    }

    private var estimatedDuration: TimeInterval {
        guard let lesson = env.sessionFlow.lesson else { return 0 }
        let selected = Set(env.sessionFlow.selectedPhraseIds)
        let durations = lesson.allLearnablePhrases
            .filter { selected.contains($0.phraseId) }
            .map { phrase in
                (es: (phrase.audioEs?.durationSeconds ?? 0), ru: (phrase.audioRu?.durationSeconds ?? 0))
            }
        return env.sessionFlow.config.estimatedDuration(phraseDurations: durations)
    }
}
