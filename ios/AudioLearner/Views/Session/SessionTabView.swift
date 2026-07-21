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
            SessionPlayerView()
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

    var body: some View {
        Group {
            if lessons.isEmpty {
                EmptyStateView(
                    systemImage: "play.slash",
                    title: "Нет уроков",
                    message: "Импортируйте урок на вкладке «Уроки», чтобы начать сессию."
                )
            } else {
                List(lessons, id: \.objectID) { lesson in
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
        .navigationTitle("Сессия")
    }
}
