import SwiftUI

/// Экран 4: плеер сессии (спека §4.6).
struct SessionPlayerView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var showEndConfirm = false

    var body: some View {
        Group {
            // Раннер создаётся и стартует в AppEnvironment.beginAudioPlayback (headless-совместимо, C12).
            if let vm = env.activeAudioSession {
                content(vm)
            } else {
                ProgressView("Подготовка сессии…")
            }
        }
        .navigationTitle("Сессия")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            // Страховка: если по какой-то причине раннер ещё не создан (прямой вход в .player),
            // создаём и стартуем его здесь.
            if env.activeAudioSession == nil {
                env.beginAudioPlayback()
            }
        }
    }

    private func content(_ vm: PlayerViewModel) -> some View {
        @Bindable var vm = vm
        let player = vm.player
        return ScrollView {
            VStack(spacing: 20) {
                sessionProgress(player)
                Divider()
                currentPhraseCard(vm, player)
                if let next = player.nextPhrase {
                    nextPhrasePreview(next)
                }
                Divider()
                controls(vm, player)
                extraControls(vm)
                sleepControl(vm, player)
                parametersSection(vm, player)
                Button(role: .destructive) {
                    showEndConfirm = true
                } label: {
                    Label("Завершить сессию", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }
            .padding()
        }
        .confirmationDialog("Завершить сессию?", isPresented: $showEndConfirm, titleVisibility: .visible) {
            Button("Завершить", role: .destructive) { vm.endEarly() }
            Button("Продолжить", role: .cancel) {}
        }
    }

    private func sessionProgress(_ player: SessionPlayerService) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("Прогресс сессии")
                    .font(.caption).foregroundStyle(.secondary)
                Spacer()
                if player.isSleepActive {
                    Label(sleepRemainingText(player), systemImage: "moon.zzz.fill")
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
            ProgressBarView(value: player.sessionProgress)
            Text("\(player.completedPhraseIds.count) / \(player.totalPhrases) фраз завершено")
                .font(.caption2).foregroundStyle(.secondary)
        }
    }

    private func sleepControl(_ vm: PlayerViewModel, _ player: SessionPlayerService) -> some View {
        let options = [0, 5, 10, 15, 30, 45]
        return HStack {
            Label("Таймер сна", systemImage: "moon.zzz")
                .font(.caption)
            Spacer()
            Menu {
                ForEach(options, id: \.self) { m in
                    Button {
                        vm.setSleepTimer(minutes: m)
                    } label: {
                        if m == player.sleepMinutes {
                            Label(m == 0 ? "Выкл" : "\(m) мин", systemImage: "checkmark")
                        } else {
                            Text(m == 0 ? "Выкл" : "\(m) мин")
                        }
                    }
                }
            } label: {
                Text(player.isSleepActive ? sleepRemainingText(player) : "Выкл")
                    .font(.caption)
            }
        }
        .padding(.horizontal, 4)
    }

    private func sleepRemainingText(_ player: SessionPlayerService) -> String {
        let s = player.sleepRemainingSeconds
        return String(format: "%d:%02d", s / 60, s % 60)
    }

    private func currentPhraseCard(_ vm: PlayerViewModel, _ player: SessionPlayerService) -> some View {
        VStack(spacing: 12) {
            Text("Повтор \(player.currentRepetition) из \(player.repetitions)")
                .font(.caption).foregroundStyle(.secondary)

            if let phrase = player.currentPhrase {
                VStack(spacing: 8) {
                    Text(phrase.textEs)
                        .font(.title2.weight(.semibold))
                        .multilineTextAlignment(.center)
                        .foregroundStyle(player.currentLanguage == .es ? Color.primary : Color.secondary)
                    Text(phrase.textRu)
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(player.currentLanguage == .ru ? Color.primary : Color.secondary)
                }
            }

            HStack {
                Image(systemName: player.isInPause ? "pause.circle" : "speaker.wave.2.fill")
                Text(player.isInPause ? "Пауза" : player.currentLanguage.rawValue.uppercased())
                Spacer()
                Text(Format.timePair(player.currentTime, player.currentDuration))
                    .font(.caption).monospacedDigit()
            }
            .font(.caption).foregroundStyle(.secondary)
            ProgressBarView(value: player.itemProgress, tint: player.isInPause ? .gray : .accentColor, height: 6)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 16).fill(Color.gray.opacity(0.08)))
    }

    private func nextPhrasePreview(_ next: PlayablePhrase) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Следующая фраза").font(.caption2).foregroundStyle(.secondary)
            Text(next.textEs).font(.subheadline)
            Text(next.textRu).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func controls(_ vm: PlayerViewModel, _ player: SessionPlayerService) -> some View {
        HStack(spacing: 28) {
            Button { vm.previous() } label: {
                Image(systemName: "backward.fill").font(.title2)
            }
            Button { vm.togglePlayPause() } label: {
                Image(systemName: player.isPlaying ? "pause.circle.fill" : "play.circle.fill")
                    .font(.system(size: 64))
            }
            Button { vm.next() } label: {
                Image(systemName: "forward.fill").font(.title2)
            }
        }
        .tint(.accentColor)
    }

    private func extraControls(_ vm: PlayerViewModel) -> some View {
        HStack(spacing: 20) {
            Button { vm.toggleFavorite() } label: {
                Label("Избранное", systemImage: vm.isCurrentFavorite ? "heart.fill" : "heart")
            }
            Button { vm.repeatPhrase() } label: {
                Label("Повторить фразу", systemImage: "repeat")
            }
        }
        .font(.caption)
        .buttonStyle(.bordered)
    }

    private func parametersSection(_ vm: PlayerViewModel, _ player: SessionPlayerService) -> some View {
        @Bindable var vm = vm
        return VStack(spacing: 8) {
            HStack {
                Text("Скорость: \(speedLabel(player.speed))")
                Spacer()
                Text("Повтор \(player.currentRepetition)/\(player.repetitions)")
                Spacer()
                Text("Пауза \(Int(player.pauseSeconds)) сек")
            }
            .font(.caption).foregroundStyle(.secondary)

            DisclosureGroup("Параметры", isExpanded: $vm.showParameters) {
                VStack(alignment: .leading) {
                    Text("Скорость: \(speedLabel(player.speed))").font(.caption)
                    Picker("Скорость", selection: Binding(
                        get: { player.speed },
                        set: { vm.setSpeed($0) }
                    )) {
                        ForEach(SessionConfig.allowedSpeeds, id: \.self) { s in
                            Text(speedLabel(s)).tag(s)
                        }
                    }
                    .pickerStyle(.segmented)
                }
                .padding(.top, 4)
            }
            .font(.caption)
        }
        .padding()
        .background(RoundedRectangle(cornerRadius: 12).fill(Color.gray.opacity(0.06)))
    }

    private func speedLabel(_ speed: Double) -> String {
        speed.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(speed)).0x" : "\(speed)x"
    }
}
