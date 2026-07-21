import SwiftUI

/// Подробности урока и экспорт прогресса (спека §4.2 контекстное меню).
struct LessonDetailView: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var lesson: Lesson

    @State private var exportURL: URL?
    @State private var showShare = false

    var body: some View {
        NavigationStack {
            List {
                Section("Урок") {
                    labeled("Название", lesson.titleRu)
                    if let es = lesson.titleEs { labeled("Оригинал", es) }
                    labeled("Тема", String(lesson.topicNumber))
                    labeled("Импортирован", Format.date(lesson.importedAt))
                }

                Section("Прогресс") {
                    let p = lesson.progress
                    LessonProgressBar(
                        learning: Int(p?.phrasesLearning ?? 0),
                        inProgress: Int(p?.phrasesInProgress ?? 0),
                        mastered: Int(p?.phrasesMastered ?? 0)
                    )
                    .padding(.vertical, 4)
                    ProgressBreakdown(
                        learning: Int(p?.phrasesLearning ?? 0),
                        inProgress: Int(p?.phrasesInProgress ?? 0),
                        mastered: Int(p?.phrasesMastered ?? 0)
                    )
                    labeled("Выучено", Format.percent(p?.percentMastered ?? 0))
                    labeled("Сессий завершено", String(p?.totalSessionsCompleted ?? 0))
                    labeled("Минут обучения", String(p?.totalMinutesLearned ?? 0))
                }

                Section("Состав") {
                    labeled("Фраз", String(lesson.phraseCount))
                    labeled("Слов", String(lesson.vocabCount))
                    labeled("Рассказов", String(lesson.storyCount))
                    labeled("Аудио-файлов", String(lesson.audioFiles.count))
                }

                Section {
                    Button {
                        exportProgress()
                    } label: {
                        Label("Экспортировать прогресс (CSV)", systemImage: "square.and.arrow.up")
                    }
                    Button {
                        env.startSession(for: lesson)
                        dismiss()
                    } label: {
                        Label("Начать сессию", systemImage: "play.fill")
                    }
                }
            }
            .navigationTitle("Подробности")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
            }
            .sheet(isPresented: $showShare) {
                if let exportURL { ShareSheet(items: [exportURL]) }
            }
        }
    }

    private func labeled(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).multilineTextAlignment(.trailing)
        }
    }

    private func exportProgress() {
        let csv = env.statistics.phrasesCSV(for: lesson)
        exportURL = try? env.statistics.writeCSV(csv, filename: "progress_\(lesson.topicId).csv")
        if exportURL != nil { showShare = true }
    }
}
