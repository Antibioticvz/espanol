import SwiftUI

/// Простой прогресс-бар с подписью процента.
struct ProgressBarView: View {
    var value: Double // 0…1
    var tint: Color = .accentColor
    var height: CGFloat = 10

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.gray.opacity(0.2))
                Capsule()
                    .fill(tint)
                    .frame(width: max(0, min(1, value)) * geo.size.width)
            }
        }
        .frame(height: height)
        .animation(.easeInOut(duration: 0.25), value: value)
    }
}

/// Трёхцветный сегментированный бар по состояниям фраз урока.
struct LessonProgressBar: View {
    var learning: Int
    var inProgress: Int
    var mastered: Int

    private var total: Int { max(1, learning + inProgress + mastered) }

    var body: some View {
        GeometryReader { geo in
            HStack(spacing: 0) {
                segment(count: mastered, color: .stateMastered, width: geo.size.width)
                segment(count: inProgress, color: .stateInProgress, width: geo.size.width)
                segment(count: learning, color: .stateLearning, width: geo.size.width)
                if learning + inProgress + mastered == 0 {
                    Rectangle().fill(Color.gray.opacity(0.2))
                }
            }
        }
        .frame(height: 10)
        .clipShape(Capsule())
    }

    private func segment(count: Int, color: Color, width: CGFloat) -> some View {
        Rectangle()
            .fill(color)
            .frame(width: CGFloat(count) / CGFloat(total) * width)
    }
}

/// Индикатор статуса фразы (иконка + цвет).
struct StateIndicator: View {
    var state: PhraseState
    var showLabel = false

    var body: some View {
        Label {
            if showLabel { Text(state.titleRu) }
        } icon: {
            Image(systemName: state.systemImage)
                .foregroundStyle(state.color)
        }
        .font(.caption)
    }
}

/// Строка-разбивка «Выучено / В процессе / Учу».
struct ProgressBreakdown: View {
    var learning: Int
    var inProgress: Int
    var mastered: Int

    var body: some View {
        HStack(spacing: 12) {
            legend(color: .stateMastered, title: "Выучено", value: mastered)
            legend(color: .stateInProgress, title: "В процессе", value: inProgress)
            legend(color: .stateLearning, title: "Учу", value: learning)
        }
        .font(.caption2)
        .foregroundStyle(.secondary)
    }

    private func legend(color: Color, title: String, value: Int) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text("\(title): \(value)")
        }
    }
}

/// Заголовок секции с эмодзи (используется в статистике/итогах).
struct SectionHeaderLabel: View {
    var emoji: String
    var title: String
    var body: some View {
        HStack(spacing: 6) {
            Text(emoji)
            Text(title).font(.headline)
        }
    }
}

/// Пустое состояние со значком и текстом.
struct EmptyStateView: View {
    var systemImage: String
    var title: String
    var message: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
    }
}
