import SwiftUI

/// Экран 5: итоги сессии (спека §4.7).
struct SessionCompletedView: View {
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        let result = env.sessionFlow.result
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header(result)
                if let result {
                    resultsSection(result)
                    if !result.transitions.isEmpty {
                        transitionsSection(result)
                    }
                    if !result.newAchievements.isEmpty {
                        achievementsSection(result)
                    }
                    if !result.recommendations.isEmpty {
                        recommendationsSection(result)
                    }
                }
                actionButtons
            }
            .padding()
        }
        .navigationTitle("Сессия завершена")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
    }

    private func header(_ result: SessionResult?) -> some View {
        VStack(spacing: 8) {
            Text("🎉").font(.system(size: 56))
            Text("Сессия завершена!").font(.title2.weight(.bold))
            if let result {
                Text(result.lessonTitle).foregroundStyle(.secondary)
                Text(Format.dateTime(result.completedAt))
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity)
    }

    private func resultsSection(_ result: SessionResult) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 8) {
                row(result.accuracy == nil ? "Фраз завершено" : "Карточек",
                    "\(result.phrasesCompleted) из \(result.phrasesTotal)")
                row("Время сеанса", Format.duration(Double(result.durationSeconds)))
                row("Среднее на фразу", Format.duration(Double(result.averageSecondsPerPhrase)))
                if let accuracy = result.accuracy {
                    row("Точность (с первого раза)", Format.percent(accuracy))
                }
            }
        } label: {
            SectionHeaderLabel(emoji: "📊", title: "Результаты")
        }
    }

    private func transitionsSection(_ result: SessionResult) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(result.transitions.enumerated()), id: \.offset) { _, t in
                    HStack {
                        Image(systemName: "arrow.up.circle.fill").foregroundStyle(t.newState.color)
                        Text("\(t.oldState.titleRu) → \(t.newState.titleRu)")
                            .font(.subheadline)
                    }
                }
            }
        } label: {
            SectionHeaderLabel(emoji: "📈", title: "Изменения статусов")
        }
    }

    private func achievementsSection(_ result: SessionResult) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(result.newAchievements) { achievement in
                    HStack {
                        Text(achievement.emoji)
                        VStack(alignment: .leading) {
                            Text(achievement.titleRu).font(.subheadline.weight(.semibold))
                            Text(achievement.detailRu).font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        } label: {
            SectionHeaderLabel(emoji: "✨", title: "Достижения разблокированы")
        }
    }

    private func recommendationsSection(_ result: SessionResult) -> some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(result.recommendations, id: \.self) { rec in
                    Label(rec, systemImage: "lightbulb").font(.subheadline)
                }
            }
        } label: {
            SectionHeaderLabel(emoji: "💡", title: "Рекомендации")
        }
    }

    private var actionButtons: some View {
        VStack(spacing: 12) {
            Button {
                env.sessionFlow.reset()
                env.selectedTab = .lessons
            } label: {
                Label("Вернуться в уроки", systemImage: "books.vertical")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)

            Button {
                env.sessionFlow.reset()
            } label: {
                Label("Новая сессия", systemImage: "play.circle")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            Button {
                env.sessionFlow.reset()
                env.selectedTab = .statistics
            } label: {
                Label("Статистика", systemImage: "chart.bar")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
        }
    }

    private func row(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.medium)
        }
        .font(.subheadline)
    }
}
