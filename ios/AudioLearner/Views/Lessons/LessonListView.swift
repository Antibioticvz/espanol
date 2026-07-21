import CoreData
import SwiftUI

enum LessonSort: String, CaseIterable, Identifiable {
    case number, title, progress, imported
    var id: String { rawValue }
    var titleRu: String {
        switch self {
        case .number: return "По номеру"
        case .title: return "По названию"
        case .progress: return "По прогрессу"
        case .imported: return "По дате импорта"
        }
    }
}

enum LessonFilter: String, CaseIterable, Identifiable {
    case all, inProgress, notStarted
    var id: String { rawValue }
    var titleRu: String {
        switch self {
        case .all: return "Все"
        case .inProgress: return "С прогрессом"
        case .notStarted: return "Не начатые"
        }
    }
}

/// Экран 1: список уроков (спека §4.2).
struct LessonListView: View {
    @Environment(AppEnvironment.self) private var env
    @FetchRequest(
        sortDescriptors: [NSSortDescriptor(key: "topicNumber", ascending: true)],
        animation: .default
    ) private var lessons: FetchedResults<Lesson>

    @State private var sort: LessonSort = .number
    @State private var filter: LessonFilter = .all
    @State private var showImport = false
    @State private var renameTarget: Lesson?
    @State private var renameText = ""
    @State private var statsTarget: Lesson?
    @State private var deleteTarget: Lesson?

    var body: some View {
        NavigationStack {
            Group {
                if lessons.isEmpty {
                    EmptyStateView(
                        systemImage: "square.and.arrow.down",
                        title: "Нет уроков",
                        message: "Импортируйте ZIP-урок кнопкой + в правом верхнем углу."
                    )
                } else {
                    List {
                        ForEach(displayedLessons, id: \.objectID) { lesson in
                            LessonRowView(lesson: lesson,
                                          onPlay: { env.startSession(for: lesson) },
                                          onStats: { statsTarget = lesson })
                            .swipeActions(edge: .trailing) {
                                Button(role: .destructive) { deleteTarget = lesson } label: {
                                    Label("Удалить", systemImage: "trash")
                                }
                            }
                            .contextMenu {
                                Button { beginRename(lesson) } label: { Label("Переименовать", systemImage: "pencil") }
                                Button { statsTarget = lesson } label: { Label("Статистика", systemImage: "chart.bar") }
                                Button(role: .destructive) { deleteTarget = lesson } label: { Label("Удалить урок", systemImage: "trash") }
                            }
                        }
                    }
                    .listStyle(.insetGrouped)
                }
            }
            .navigationTitle("Уроки")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Menu {
                        Picker("Сортировка", selection: $sort) {
                            ForEach(LessonSort.allCases) { Text($0.titleRu).tag($0) }
                        }
                        Picker("Фильтр", selection: $filter) {
                            ForEach(LessonFilter.allCases) { Text($0.titleRu).tag($0) }
                        }
                    } label: {
                        Image(systemName: "line.3.horizontal.decrease.circle")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showImport = true } label: { Image(systemName: "plus") }
                }
            }
            .sheet(isPresented: $showImport) {
                ImportLessonView(initialURL: nil)
            }
            .sheet(item: $statsTarget) { lesson in
                LessonDetailView(lesson: lesson)
            }
            .alert("Переименовать урок", isPresented: Binding(get: { renameTarget != nil }, set: { if !$0 { renameTarget = nil } })) {
                TextField("Название", text: $renameText)
                Button("Отмена", role: .cancel) { renameTarget = nil }
                Button("Сохранить") { commitRename() }
            }
            .confirmationDialog(
                "Удалить урок?",
                isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
                titleVisibility: .visible,
                presenting: deleteTarget
            ) { lesson in
                Button("Удалить «\(lesson.titleRu)»", role: .destructive) { performDelete(lesson) }
                Button("Отмена", role: .cancel) { deleteTarget = nil }
            } message: { _ in
                Text("Урок и весь его прогресс будут удалены безвозвратно.")
            }
            .onChange(of: env.pendingImportURL) { _, newValue in
                if newValue != nil { showImport = true }
            }
        }
    }

    private var displayedLessons: [Lesson] {
        var result = Array(lessons)
        switch filter {
        case .all: break
        case .inProgress:
            result = result.filter { ($0.progress?.phrasesInProgress ?? 0) + ($0.progress?.phrasesMastered ?? 0) > 0 }
        case .notStarted:
            result = result.filter { ($0.progress?.phrasesInProgress ?? 0) + ($0.progress?.phrasesMastered ?? 0) == 0 }
        }
        switch sort {
        case .number: result.sort { $0.topicNumber < $1.topicNumber }
        case .title: result.sort { $0.titleRu < $1.titleRu }
        case .progress: result.sort { ($0.progress?.percentMastered ?? 0) > ($1.progress?.percentMastered ?? 0) }
        case .imported: result.sort { $0.importedAt > $1.importedAt }
        }
        return result
    }

    private func performDelete(_ lesson: Lesson) {
        // Если удаляем урок идущей сессии — сперва гасим её (иначе крэш на invalidated объекте).
        if env.sessionFlow.lesson?.objectID == lesson.objectID {
            env.endActiveSession(abandoned: true)
            env.sessionFlow.reset()
        }
        try? env.repository.delete(lesson)
        env.refreshWidgetStats()
        deleteTarget = nil
    }

    private func beginRename(_ lesson: Lesson) {
        renameText = lesson.titleRu
        renameTarget = lesson
    }

    private func commitRename() {
        guard let lesson = renameTarget else { return }
        try? env.repository.rename(lesson, to: renameText)
        renameTarget = nil
    }
}

/// Строка урока со сводкой и прогрессом.
struct LessonRowView: View {
    @ObservedObject var lesson: Lesson
    var onPlay: () -> Void
    var onStats: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("📚 \(lesson.titleRu)")
                    .font(.headline)
                Spacer()
                Text("Тема \(String(format: "%02d", lesson.topicNumber))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Text("\(Format.phraseCount(Int(lesson.phraseCount))) · \(Format.wordCount(Int(lesson.vocabCount)))")
                .font(.caption)
                .foregroundStyle(.secondary)

            let p = lesson.progress
            LessonProgressBar(
                learning: Int(p?.phrasesLearning ?? 0),
                inProgress: Int(p?.phrasesInProgress ?? 0),
                mastered: Int(p?.phrasesMastered ?? 0)
            )
            HStack {
                Text(Format.percent(p?.percentMastered ?? 0) + " выучено")
                    .font(.caption2).foregroundStyle(.secondary)
                Spacer()
                Text("Импорт: \(Format.date(lesson.importedAt))")
                    .font(.caption2).foregroundStyle(.secondary)
            }
            ProgressBreakdown(
                learning: Int(p?.phrasesLearning ?? 0),
                inProgress: Int(p?.phrasesInProgress ?? 0),
                mastered: Int(p?.phrasesMastered ?? 0)
            )

            HStack(spacing: 12) {
                Button(action: onPlay) {
                    Label("Играть", systemImage: "play.fill")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                Button(action: onStats) {
                    Label("Статистика", systemImage: "chart.bar")
                        .font(.subheadline)
                }
                .buttonStyle(.bordered)
            }
            .padding(.top, 2)
        }
        .padding(.vertical, 6)
    }
}
