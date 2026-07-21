import SwiftUI

/// Экран флеш-карт (v1.1, D-19): вопрос → показать ответ → «Знал»/«Не знал» (+ свайпы).
struct FlashcardView: View {
    @Environment(AppEnvironment.self) private var env
    @State private var vm: FlashcardViewModel?
    @State private var started = false
    @State private var showEndConfirm = false
    @State private var dragOffset: CGSize = .zero

    var body: some View {
        Group {
            if let vm {
                content(vm)
            } else {
                ProgressView("Подготовка колоды…")
            }
        }
        .navigationTitle("Флеш-карты")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if vm == nil {
                vm = FlashcardViewModel(env: env, flow: env.sessionFlow)
            }
            if !started {
                started = true
                vm?.start()
            }
        }
    }

    private func content(_ vm: FlashcardViewModel) -> some View {
        VStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Карточка \(vm.cardNumber) из \(vm.totalCards)")
                    .font(.caption).foregroundStyle(.secondary)
                ProgressBarView(value: vm.progress)
            }

            Spacer()
            card(vm)
                .offset(x: dragOffset.width, y: dragOffset.height / 8)
                .rotationEffect(.degrees(Double(dragOffset.width / 24)))
                .gesture(swipeGesture(vm))
            Spacer()

            controls(vm)

            Button(role: .destructive) { showEndConfirm = true } label: {
                Label("Завершить сессию", systemImage: "stop.fill")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
        .padding()
        .confirmationDialog("Завершить сессию?", isPresented: $showEndConfirm, titleVisibility: .visible) {
            Button("Завершить", role: .destructive) { vm.endEarly() }
            Button("Продолжить", role: .cancel) {}
        }
    }

    private func card(_ vm: FlashcardViewModel) -> some View {
        VStack(spacing: 16) {
            side(label: vm.questionLanguageLabel, text: vm.questionText,
                 emphasized: true) { vm.playQuestion() }

            if vm.showAnswer {
                Divider()
                side(label: vm.answerLanguageLabel, text: vm.answerText,
                     emphasized: false) { vm.playAnswer() }
            }
        }
        .frame(maxWidth: .infinity)
        .padding(28)
        .background(RoundedRectangle(cornerRadius: 20).fill(Color.gray.opacity(0.08)))
        .overlay(alignment: .topLeading) { swipeBadge(text: "Не знал", color: .red, show: dragOffset.width < -40) }
        .overlay(alignment: .topTrailing) { swipeBadge(text: "Знал", color: .green, show: dragOffset.width > 40) }
    }

    private func side(label: String, text: String, emphasized: Bool, play: @escaping () -> Void) -> some View {
        VStack(spacing: 10) {
            Text(label).font(.caption2).foregroundStyle(.secondary)
            Text(text)
                .font(emphasized ? .largeTitle.weight(.semibold) : .title)
                .multilineTextAlignment(.center)
                .foregroundStyle(emphasized ? Color.primary : Color.secondary)
            Button(action: play) {
                Image(systemName: emphasized ? "speaker.wave.2.circle.fill" : "speaker.wave.2.circle")
                    .font(.title)
            }
            .buttonStyle(.plain)
            .tint(.accentColor)
        }
    }

    @ViewBuilder
    private func controls(_ vm: FlashcardViewModel) -> some View {
        if vm.showAnswer {
            HStack(spacing: 16) {
                Button { withAnimation { dragOffset = .zero; vm.markUnknown() } } label: {
                    Label("Не знал", systemImage: "xmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.red)
                Button { withAnimation { dragOffset = .zero; vm.markKnown() } } label: {
                    Label("Знал", systemImage: "checkmark").frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent).tint(.green)
            }
        } else {
            Button { withAnimation { vm.reveal() } } label: {
                Label("Показать ответ", systemImage: "eye").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
    }

    @ViewBuilder
    private func swipeBadge(text: String, color: Color, show: Bool) -> some View {
        if show {
            Text(text)
                .font(.caption.weight(.bold))
                .padding(.horizontal, 10).padding(.vertical, 4)
                .background(color.opacity(0.85))
                .foregroundStyle(.white)
                .clipShape(Capsule())
                .padding(12)
        }
    }

    private func swipeGesture(_ vm: FlashcardViewModel) -> some Gesture {
        DragGesture()
            .onChanged { value in
                if vm.showAnswer { dragOffset = value.translation }
            }
            .onEnded { value in
                guard vm.showAnswer else { dragOffset = .zero; return }
                let threshold: CGFloat = 100
                if value.translation.width > threshold {
                    withAnimation { dragOffset = .zero; vm.markKnown() }
                } else if value.translation.width < -threshold {
                    withAnimation { dragOffset = .zero; vm.markUnknown() }
                } else {
                    withAnimation { dragOffset = .zero }
                }
            }
    }
}
