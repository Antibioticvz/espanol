import CoreData
import SwiftUI

/// Вкладка «Сессия»: оркестрирует флоу выбор → настройки → плеер → итоги (спека §4.4–4.7).
struct SessionTabView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        NavigationStack {
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        switch env.sessionFlow.step {
        case .pickLesson:
            SessionLessonPickerView()
        case .selectPhrases:
            PhraseSelectionView()
        case .config:
            SessionConfigView()
        case .player:
            if env.sessionFlow.config.isFlashcards {
                FlashcardView()
            } else {
                SessionPlayerView()
            }
        case .completed:
            SessionCompletedView()
        }
    }
}

/// Стартовый выбор урока для сессии, если не пришли из списка «Играть».
struct SessionLessonPickerView: View {
    @Environment(AppEnvironment.self) private var env
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "topicNumber", ascending: true)]
    ) private var lessons: FetchedResults<Lesson>

    @State private var showNothingToReview = false

    var body: some View {
        Group {
            if lessons.isEmpty {
                EmptyStateView(
                    systemImage: "play.slash",
                    title: "Нет уроков",
                    message: "Импортируйте урок на вкладке «Уроки», чтобы начать сессию."
                )
            } else {
                List {
                    Section {
                        Button {
                            if !env.startDailySession() { showNothingToReview = true }
                        } label: {
                            HStack(spacing: 12) {
                                Image(systemName: "sparkles")
                                    .font(.title2)
                                    .foregroundStyle(.tint)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Сессия дня").font(.headline)
                                    Text("Автоподбор фраз к повтору по всем урокам")
                                        .font(.caption).foregroundStyle(.secondary)
                                }
                                Spacer()
                                Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.tint)
                            }
                        }
                        .buttonStyle(.plain)
                    }

                    Section("Уроки") {
                        ForEach(lessons, id: \.objectID) { lesson in
                            Button {
                                env.startSession(for: lesson)
                            } label: {
                                HStack {
                                    VStack(alignment: .leading) {
                                        Text(lesson.titleRu).font(.headline)
                                        Text(Format.phraseCount(lesson.allLearnablePhrases.count))
                                            .font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right").foregroundStyle(.secondary)
                                }
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .navigationTitle("Сессия")
        .alert("Всё повторено", isPresented: $showNothingToReview) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Сейчас нет фраз к повтору. Возвращайтесь позже.")
        }
    }
}
